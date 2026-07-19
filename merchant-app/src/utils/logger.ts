export const logger = {
  error: (...args: any[]) => {
    if (__DEV__) console.error(...args);
  },
  warn: (...args: any[]) => {
    if (__DEV__) console.warn(...args);
  },
};
