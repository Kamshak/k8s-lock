import * as bluebird from 'bluebird';

/**
 * Calls the op function repeatedly until it resolves with a truthy value.
 * Returns a promise that resolves with that value or errors on timeout.
 *
 * @param op operation to perform
 * @param delay polling interval
 * @param timeout timeout
 */
export function repeatUntilSuccessful<T>(
  op: (...args: any[]) => Promise<T | false> | T | false,
  delay: number,
  timeout: number,
  backoff?: boolean
): Promise<T> {
  let timedOut = false;
  let delayWithBackoff = delay;

  function repeater(): Promise<T> {
    if (timedOut) {
      return;
    }

    return Promise.resolve().then(op)
      .then((success) => {
        if (!success) {
          return bluebird.delay(delayWithBackoff)
            .then(() => {
              if (backoff) {
                delayWithBackoff *= 1.5;
              }
              return repeater()
            });
        }
        return success;
      });
  }

  let promise = bluebird.resolve().then(repeater);
  if (timeout) {
    promise = promise.timeout(timeout)
      .catch(bluebird.TimeoutError, (error) => {
        timedOut = true;
        throw error; // Rethrow
      });
  }

  return Promise.resolve(promise);
}
