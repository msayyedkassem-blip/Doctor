/**
 * Settings the shared code needs but that are discovered differently in each
 * place it runs: from environment variables on a server, from defaults or
 * stored preferences inside a phone.
 */
export const runtime = {
  sessionDays: 30,
  secureCookies: false,
  port: 4000,
};

export function configureRuntime(values) {
  Object.assign(runtime, values);
}
