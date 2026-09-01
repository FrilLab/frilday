export type AsyncOperation = () => Promise<void>;

// (role: serialized async mutation queue, type: (AsyncOperation)=>Promise<void>)
export function createSerialQueue(): (operation: AsyncOperation) => Promise<void> {
  let queue: Promise<void> = Promise.resolve();

  return (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };
}
