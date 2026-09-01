export type AsyncOperation<T = void> = () => Promise<T>;

// (role: serialized async mutation queue, type: (AsyncOperation<T>)=>Promise<T>)
export function createSerialQueue<T = void>(): (
  operation: AsyncOperation<T>,
) => Promise<T> {
  let queue: Promise<void> = Promise.resolve();

  return (operation) => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
