/**
 * Minimal Deno surface used by the functions, so the code can be type-checked with plain `tsc`
 * in CI without a Deno runtime. The real Deno types are provided by the Supabase CLI at deploy time.
 */
declare namespace Deno {
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
  namespace env {
    function get(key: string): string | undefined;
  }
}
