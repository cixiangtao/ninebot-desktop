import { parseRideMonth } from "./parsers.js";
import { NinebotClientError } from "./app-client.js";
import { NinebotHttpError } from "@jiuhao/ninebot-client";
import type { TravelReader } from "./travel-source.js";

/**
 * Keeps ninecli as the primary travel oracle and uses the TypeScript protocol
 * bridge only when ninecli reports that the month has more rows than it
 * returned. The bridge re-reads the entire month, including page one, to keep
 * one consistent source for the merged rows. It is limited to month pagination; details
 * continue to use ninecli so the runtime boundary remains stable.
 */
export const createHybridTravelReader = ({
  ninecli,
  paginated,
  refreshSession,
}: {
  ninecli: TravelReader;
  paginated: TravelReader;
  /** Refreshes ninecli's persisted session before the secondary protocol reads it. */
  refreshSession?: () => Promise<unknown>;
}): TravelReader => {
  let generation = 0;
  const assertActive = (requestGeneration: number) => {
    if (generation !== requestGeneration) {
      throw new NinebotClientError("月份读取已取消，请重新加载。");
    }
  };
  return {
    clear() {
      generation += 1;
      ninecli.clear?.();
      paginated.clear?.();
    },
    async rides(serialNumber, month) {
      const requestGeneration = generation;
      const firstPage = await ninecli.rides(serialNumber, month);
      assertActive(requestGeneration);
      const parsed = parseRideMonth(firstPage, month);
      if (!parsed.summary.ridesTruncated) return firstPage;
      try {
        await refreshSession?.();
        assertActive(requestGeneration);
        let complete: unknown = undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            // Retry sequentially so only one encrypted month request is in flight.
            // eslint-disable-next-line no-await-in-loop
            complete = await paginated.rides(serialNumber, month);
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            if (error instanceof NinebotHttpError && (error.status === 401 || error.status === 403))
              throw error;
            if (attempt === 0) {
              // eslint-disable-next-line no-await-in-loop
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          }
        }
        if (lastError !== undefined) throw lastError;
        assertActive(requestGeneration);
        const envelope = complete as { code?: unknown };
        if (typeof envelope.code === "number" && envelope.code !== 0) {
          throw new NinebotClientError("月度轨迹分页鉴权失败，请重新连接账号。", "auth");
        }
        const result = parseRideMonth(complete, month);
        const uniqueIds = new Set(result.rides.map(({ travelId }) => travelId));
        if (
          !result.summary.aggregateAvailable ||
          result.summary.ridesTruncated ||
          result.summary.rideCount < parsed.summary.rideCount ||
          uniqueIds.size !== result.rides.length
        ) {
          console.warn("ninecli travel pagination incomplete", {
            month,
            declaredCount: result.summary.rideCount,
            returnedCount: result.rides.length,
            uniqueCount: uniqueIds.size,
          });
          throw new NinebotClientError("月度轨迹分页返回不完整，请刷新重试。", "upstream");
        }
        return complete;
      } catch (error) {
        if (error instanceof NinebotClientError && error.kind === "auth") throw error;
        if (error instanceof NinebotClientError) throw error;
        if (error instanceof NinebotHttpError && (error.status === 401 || error.status === 403)) {
          throw new NinebotClientError("月度轨迹分页鉴权失败，请重新连接账号。", "auth");
        }
        // Do not leak protocol responses or silently return a truncated export.
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        const safeMessage = errorMessage.replace(/https?:\/\/[^\s)]+/g, "<redacted-url>");
        console.warn("ninecli travel pagination request failed", {
          month,
          errorType: error instanceof Error ? error.name : typeof error,
          errorMessage: safeMessage.slice(0, 160),
        });
        const category = /timeout|timed out|abort/i.test(errorMessage)
          ? "请求超时"
          : /fetch failed|network|econn|enotfound|tls/i.test(errorMessage)
            ? "网络连接失败"
            : "上游响应异常";
        throw new NinebotClientError(`月度轨迹分页${category}，请刷新重试。`, "upstream");
      }
    },
    rideDetail(serialNumber, travelId) {
      return ninecli.rideDetail(serialNumber, travelId);
    },
  };
};
