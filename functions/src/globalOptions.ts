/**
 * Options every function shares. Imported first by index.ts, so it runs
 * before any function is defined.
 *
 * A function that sets its own `secrets` replaces this list rather than adding
 * to it, so those include PIN_PEPPER themselves.
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { PIN_PEPPER } from "./config/secrets";

setGlobalOptions({ secrets: [PIN_PEPPER] });
