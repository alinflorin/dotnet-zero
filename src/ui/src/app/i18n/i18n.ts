import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from "i18next-browser-languagedetector"

import en from "../../locales/en/common.json"
import ro from "../../locales/ro/common.json"

export const supportedLanguages = ["en", "ro"] as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      ro: { common: ro },
    },
    ns: ["common"],
    defaultNS: "common",
    fallbackLng: "en",
    supportedLngs: supportedLanguages,
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "zero.language",
      caches: ["localStorage"],
    },
  })

export default i18n
