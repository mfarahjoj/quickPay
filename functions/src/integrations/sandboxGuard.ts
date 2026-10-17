/**
 * Where the Zaad, eDahab and Stripe sandbox stubs may answer.
 *
 * Each stub's `*_SANDBOX` flag defaults to "true" whenever its env var is
 * unset, which is the state of the deployed project, and in sandbox every
 * call "succeeds". Three exported callables once turned that fake success into
 * real wallet credits (BACKLOG 3b). So the stubs only answer in tests and the
 * emulator; in a deployed function the sandbox branch fails instead, and no
 * stub output can lead to a credit even if a caller forgets to check.
 */

/** True when running as a deployed Cloud Function rather than locally. */
export function isDeployedFunction(env: NodeJS.ProcessEnv = process.env): boolean {
  // Cloud Functions v2 run on Cloud Run, which sets K_SERVICE. The emulator
  // sets it too, and marks itself with FUNCTIONS_EMULATOR.
  return Boolean(env.K_SERVICE) && env.FUNCTIONS_EMULATOR !== "true";
}

/** True when a sandbox stub may return its fake success. */
export function sandboxAllowedHere(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isDeployedFunction(env);
}

export const SANDBOX_REFUSED = "Payment rail not connected";
