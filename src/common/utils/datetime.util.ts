import dayjs from 'dayjs';

export const nowDate = (): string => dayjs().format('YYYY-MM-DD');

export const nowStamp = (): string => dayjs().format('YYYYMMDD-HHmmss');

export const toIso = (value: number | string | Date): string =>
  dayjs(value).toISOString();
