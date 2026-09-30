import en from "./messages/en.json";
import es from "./messages/es.json";

// Both directions, so a key missing from either language fails the typecheck.
export const messages = {
  en: en satisfies typeof es,
  es: es satisfies typeof en,
};
