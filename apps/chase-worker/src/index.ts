import type { Env } from "./env.js";
import { route } from "./router.js";
import { runNightlySweep } from "./sync.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },

  /**
   * Two crons, one handler, branching on which fired.
   *
   *   15 2 * * *  the Companies House sweep (CH1)
   *   0 9 * * *   the chase sweep and, on Mondays, the firm digest (CH2/CH3)
   *
   * A sweep never throws out of here: a provider failure is recorded on the
   * company row and the run continues, because one unreachable company must
   * not stop the other 1,999.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "15 2 * * *") {
      ctx.waitUntil(runNightlySweep(env));
    }
  },
} satisfies ExportedHandler<Env>;
