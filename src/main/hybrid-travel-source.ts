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
}: {
  ninecli: TravelReader;
  paginated: TravelReader;
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
        const complete = await paginated.rides(serialNumber, month);
        assertActive(requestGeneration);
        const result = parseRideMonth(complete, month);
        const uniqueIds = new Set(result.rides.map(({ travelId }) => travelId));
        if (
          !result.summary.aggregateAvailable ||
          result.summary.ridesTruncated ||
          result.summary.rideCount < parsed.summary.rideCount ||
          uniqueIds.size !== result.rides.length
        )
          throw new Error("Incomplete month");
        return complete;
      } catch (error) {
        if (error instanceof NinebotHttpError && (error.status === 401 || error.status === 403)) {
          throw new NinebotClientError("月度轨迹分页鉴权失败，请重新连接账号。", "auth");
        }
        // Do not leak protocol responses or silently return a truncated export.
        throw new NinebotClientError("完整月份读取失败，请刷新重试；若持续失败，请重新连接账号。");
      }
    },
    rideDetail(serialNumber, travelId) {
      return ninecli.rideDetail(serialNumber, travelId);
    },
  };
};
