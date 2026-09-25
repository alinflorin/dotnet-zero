using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Text;

namespace engine.Debugging;

/// <summary>
/// Rewrites a document's syntax tree so that, once compiled, running it calls into
/// <c>__DebugRuntime.DebugHook</c> (see <see cref="DebugRuntimeSource"/>) at each statement,
/// allowing the debug session to pause, capture in-scope locals, and track a call stack.
///
/// This is a statement-level instrumentation debugger, not an IL/sequence-point one: there is
/// no PDB emitted and no CLR debugger API reachable from inside the Blazor WASM sandbox, so
/// pausing/stepping/inspecting locals is implemented entirely by rewriting the user's source
/// before compiling a separate, debug-only assembly (normal Compile/Run are untouched).
///
/// Known v1 limitations (breakpoints inside these silently never fire, matching the shape
/// they have in real IDEs when debug info is unavailable there): lambdas, anonymous methods,
/// async methods, and iterators are left uninstrumented.
/// </summary>
public sealed class DebugInstrumentationRewriter(SemanticModel semanticModel, string fileId) : CSharpSyntaxRewriter
{
    private static readonly ExpressionSyntax HookTarget = SyntaxFactory.ParseExpression("global::__DebugRuntime.DebugHook");

    // Set while inside a `static` local function, to the span of that local function. A static
    // local function cannot capture outer locals/parameters (CS8421), so locals-in-scope
    // collection must be restricted to symbols declared within this span. Nested non-static
    // local functions inherit the nearest enclosing static boundary (they still can't reach
    // outside it), so this is only ever narrowed, never cleared, once set.
    private TextSpan? _staticBoundary;

    public override SyntaxNode? VisitCompilationUnit(CompilationUnitSyntax node)
    {
        var globalIndices = new List<int>();
        for (var i = 0; i < node.Members.Count; i++)
        {
            if (node.Members[i] is GlobalStatementSyntax) globalIndices.Add(i);
        }

        if (globalIndices.Count == 0)
            return base.VisitCompilationUnit(node);

        var originalStatements = globalIndices.Select(i => ((GlobalStatementSyntax)node.Members[i]).Statement).ToList();
        var enterStmt = SyntaxFactory.ExpressionStatement(BuildEnterCall("Main", originalStatements[0]));
        var exitStmt = SyntaxFactory.ExpressionStatement(BuildExitCall());
        var rewrittenInner = RewriteStatementList(originalStatements);
        var tryStatement = SyntaxFactory.TryStatement(
            SyntaxFactory.Block(rewrittenInner),
            default,
            SyntaxFactory.FinallyClause(SyntaxFactory.Block(exitStmt)));
        var combinedGlobalStatement = SyntaxFactory.GlobalStatement(SyntaxFactory.Block(enterStmt, tryStatement));

        var newMembers = new List<MemberDeclarationSyntax>();
        var inserted = false;
        foreach (var member in node.Members)
        {
            if (member is GlobalStatementSyntax)
            {
                if (!inserted)
                {
                    newMembers.Add(combinedGlobalStatement);
                    inserted = true;
                }
                continue;
            }

            newMembers.Add((MemberDeclarationSyntax)Visit(member)!);
        }

        return node.WithMembers(SyntaxFactory.List(newMembers));
    }

    public override SyntaxNode? VisitMethodDeclaration(MethodDeclarationSyntax node)
    {
        if (node.Body is null) return node;
        if (IsAsyncOrIterator(node.Modifiers, node.Body)) return node;

        return node.WithBody(InstrumentMethodBody(node.Body, node.Identifier.Text));
    }

    public override SyntaxNode? VisitConstructorDeclaration(ConstructorDeclarationSyntax node)
    {
        if (node.Body is null) return node;
        if (IsAsyncOrIterator(node.Modifiers, node.Body)) return node;

        return node.WithBody(InstrumentMethodBody(node.Body, node.Identifier.Text + ".ctor"));
    }

    public override SyntaxNode? VisitLocalFunctionStatement(LocalFunctionStatementSyntax node)
    {
        if (node.Body is null) return node;
        if (IsAsyncOrIterator(node.Modifiers, node.Body)) return node;

        var isStatic = node.Modifiers.Any(SyntaxKind.StaticKeyword);
        var previousBoundary = _staticBoundary;
        if (isStatic) _staticBoundary = node.Span;
        try
        {
            return node.WithBody(InstrumentMethodBody(node.Body, node.Identifier.Text));
        }
        finally
        {
            _staticBoundary = previousBoundary;
        }
    }

    // Lambdas/anonymous methods are intentionally left completely unvisited (see class remarks).
    public override SyntaxNode? VisitSimpleLambdaExpression(SimpleLambdaExpressionSyntax node) => node;
    public override SyntaxNode? VisitParenthesizedLambdaExpression(ParenthesizedLambdaExpressionSyntax node) => node;
    public override SyntaxNode? VisitAnonymousMethodExpression(AnonymousMethodExpressionSyntax node) => node;

    public override SyntaxNode? VisitBlock(BlockSyntax node) => node.WithStatements(SyntaxFactory.List(RewriteStatementList(node.Statements)));

    public override SyntaxNode? VisitSwitchSection(SwitchSectionSyntax node) => node.WithStatements(SyntaxFactory.List(RewriteStatementList(node.Statements)));

    public override SyntaxNode? VisitIfStatement(IfStatementSyntax node)
    {
        var condition = (ExpressionSyntax)Visit(node.Condition)!;
        var thenStatement = VisitEmbeddedStatement(node.Statement);
        var elseClause = node.Else is null ? null : node.Else.WithStatement(VisitEmbeddedStatement(node.Else.Statement));
        return node.WithCondition(condition).WithStatement(thenStatement).WithElse(elseClause);
    }

    public override SyntaxNode? VisitForStatement(ForStatementSyntax node) => node.WithStatement(VisitEmbeddedStatement(node.Statement));

    public override SyntaxNode? VisitForEachStatement(ForEachStatementSyntax node) => node.WithStatement(VisitEmbeddedStatement(node.Statement));

    public override SyntaxNode? VisitWhileStatement(WhileStatementSyntax node) => node.WithStatement(VisitEmbeddedStatement(node.Statement));

    public override SyntaxNode? VisitDoStatement(DoStatementSyntax node) => node.WithStatement(VisitEmbeddedStatement(node.Statement));

    public override SyntaxNode? VisitUsingStatement(UsingStatementSyntax node) => node.WithStatement(VisitEmbeddedStatement(node.Statement));

    public override SyntaxNode? VisitLockStatement(LockStatementSyntax node) => node.WithStatement(VisitEmbeddedStatement(node.Statement));

    public override SyntaxNode? VisitFixedStatement(FixedStatementSyntax node) => node.WithStatement(VisitEmbeddedStatement(node.Statement));

    private StatementSyntax VisitEmbeddedStatement(StatementSyntax original)
    {
        if (original is BlockSyntax block)
            return (StatementSyntax)VisitBlock(block)!;

        var hook = BuildStepStatement(original);
        var visited = (StatementSyntax)Visit(original)!;
        return SyntaxFactory.Block(hook, visited);
    }

    private List<StatementSyntax> RewriteStatementList(IEnumerable<StatementSyntax> statements)
    {
        var result = new List<StatementSyntax>();
        foreach (var original in statements)
        {
            result.Add(BuildStepStatement(original));
            result.Add((StatementSyntax)Visit(original)!);
        }

        return result;
    }

    private BlockSyntax InstrumentMethodBody(BlockSyntax body, string methodName)
    {
        var enterStmt = SyntaxFactory.ExpressionStatement(BuildEnterCall(methodName, (SyntaxNode?)body.Statements.FirstOrDefault() ?? body));
        var exitStmt = SyntaxFactory.ExpressionStatement(BuildExitCall());
        var rewrittenInner = RewriteStatementList(body.Statements);
        var tryStatement = SyntaxFactory.TryStatement(
            SyntaxFactory.Block(rewrittenInner),
            default,
            SyntaxFactory.FinallyClause(SyntaxFactory.Block(exitStmt)));

        return SyntaxFactory.Block(enterStmt, tryStatement);
    }

    private static bool IsAsyncOrIterator(SyntaxTokenList modifiers, SyntaxNode body) =>
        modifiers.Any(SyntaxKind.AsyncKeyword) || ContainsYield(body);

    private static bool ContainsYield(SyntaxNode node) =>
        node.DescendantNodes(descendIntoChildren: n => n is not (
                SimpleLambdaExpressionSyntax or ParenthesizedLambdaExpressionSyntax or
                AnonymousMethodExpressionSyntax or LocalFunctionStatementSyntax))
            .OfType<YieldStatementSyntax>()
            .Any();

    private ExpressionSyntax BuildEnterCall(string methodName, SyntaxNode locationNode)
    {
        var line = locationNode.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
        return Invoke("EnterMethod", StringLiteral(methodName), StringLiteral(fileId), IntLiteral(line));
    }

    private ExpressionSyntax BuildExitCall() => Invoke("ExitMethod");

    private StatementSyntax BuildStepStatement(StatementSyntax original)
    {
        var position = original.GetLocation().GetLineSpan().StartLinePosition;
        var call = Invoke("OnStep", StringLiteral(fileId), IntLiteral(position.Line + 1), IntLiteral(position.Character + 1), BuildLocalsLambda(original));
        return SyntaxFactory.ExpressionStatement(call);
    }

    private ExpressionSyntax BuildLocalsLambda(StatementSyntax original)
    {
        var elements = CollectInScopeSymbols(original).Select(BuildTupleElement).ToList();
        var arrayType = (ArrayTypeSyntax)SyntaxFactory.ParseTypeName("(string Name, object? Value)[]");
        var initializer = elements.Count == 0
            ? SyntaxFactory.InitializerExpression(SyntaxKind.ArrayInitializerExpression)
            : SyntaxFactory.InitializerExpression(SyntaxKind.ArrayInitializerExpression, SyntaxFactory.SeparatedList(elements));
        ExpressionSyntax arrayExpr = SyntaxFactory.ArrayCreationExpression(arrayType, initializer);

        return SyntaxFactory.ParenthesizedLambdaExpression(SyntaxFactory.ParameterList(), arrayExpr);
    }

    private static ExpressionSyntax BuildTupleElement(ISymbol symbol)
    {
        var valueExpr = SyntaxFactory.CastExpression(
            SyntaxFactory.NullableType(SyntaxFactory.PredefinedType(SyntaxFactory.Token(SyntaxKind.ObjectKeyword))),
            SyntaxFactory.IdentifierName(symbol.Name));

        return SyntaxFactory.TupleExpression(SyntaxFactory.SeparatedList(new[]
        {
            SyntaxFactory.Argument(StringLiteral(symbol.Name)),
            SyntaxFactory.Argument(valueExpr),
        }));
    }

    /// <summary>
    /// In-scope locals/parameters at <paramref name="original"/>'s start, filtered to those
    /// definitely assigned on entry — required because referencing a not-yet-definitely-assigned
    /// local (e.g. an unassigned <c>out</c> parameter, or a declared-but-not-yet-initialized
    /// local) is a compile error in the generated code, not just a runtime concern.
    /// </summary>
    private List<ISymbol> CollectInScopeSymbols(StatementSyntax original)
    {
        try
        {
            var candidates = semanticModel.LookupSymbols(original.SpanStart)
                .Where(s => s is ILocalSymbol { IsConst: false } or IParameterSymbol)
                .ToList();
            if (candidates.Count == 0) return candidates;

            if (_staticBoundary is { } boundary)
            {
                candidates = candidates
                    .Where(s => s.Locations.Any(loc => loc.IsInSource && boundary.Contains(loc.SourceSpan)))
                    .ToList();
                if (candidates.Count == 0) return candidates;
            }

            var dataFlow = semanticModel.AnalyzeDataFlow(original);
            if (dataFlow is not { Succeeded: true }) return [];

            var assigned = dataFlow.DefinitelyAssignedOnEntry;
            return candidates.Where(s => assigned.Contains(s, SymbolEqualityComparer.Default)).ToList();
        }
        catch
        {
            return [];
        }
    }

    private static ExpressionSyntax Invoke(string methodName, params ExpressionSyntax[] args) =>
        SyntaxFactory.InvocationExpression(
            SyntaxFactory.MemberAccessExpression(SyntaxKind.SimpleMemberAccessExpression, HookTarget, SyntaxFactory.IdentifierName(methodName)),
            SyntaxFactory.ArgumentList(SyntaxFactory.SeparatedList(args.Select(SyntaxFactory.Argument))));

    private static ExpressionSyntax StringLiteral(string value) => SyntaxFactory.LiteralExpression(SyntaxKind.StringLiteralExpression, SyntaxFactory.Literal(value));

    private static ExpressionSyntax IntLiteral(int value) => SyntaxFactory.LiteralExpression(SyntaxKind.NumericLiteralExpression, SyntaxFactory.Literal(value));
}
