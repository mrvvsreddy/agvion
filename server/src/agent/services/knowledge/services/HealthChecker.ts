// knowledge/services/HealthChecker.ts
/**
 * Shared health check utility to reduce code duplication across services
 */

export class HealthChecker {
  /**
   * Check health of multiple dependencies in parallel
   * @param dependencies Record of dependency names to their check functions
   * @returns Health check result with overall status and individual dependency statuses
   */
  static async check(
    dependencies: Record<string, () => Promise<boolean>>
  ): Promise<{ healthy: boolean; details: Record<string, boolean> }> {
    const details: Record<string, boolean> = {};

    // Check all dependencies in parallel
    await Promise.all(
      Object.entries(dependencies).map(async ([name, checkFn]) => {
        try {
          details[name] = await checkFn();
        } catch (error) {
          details[name] = false;
        }
      })
    );

    // Overall health is true only if all dependencies are healthy
    const healthy = Object.values(details).every(v => v === true);
    return { healthy, details };
  }
}

