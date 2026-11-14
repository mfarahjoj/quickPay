import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';
import { leadCurrency, otherCurrency, type Currency } from '../utils/money';

const HOME_CURRENCY_KEY = '@quickpay_home_currency';

/**
 * Which balance Home shows. Home shows one currency at a time and the
 * customer switches with the currency button; the choice is kept on the
 * phone. Until they choose, `leadCurrency` decides.
 */
export function useHomeCurrency(usdCents: number, slsBalance: number) {
  const [chosen, setChosen] = useState<Currency | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(HOME_CURRENCY_KEY)
      .then((value) => {
        if (value === 'USD' || value === 'SLS') setChosen((now) => now ?? value);
      })
      .catch((err) => logger.error('Home currency read error:', err));
  }, []);

  const currency = chosen ?? leadCurrency(usdCents, slsBalance);

  const switchCurrency = useCallback(() => {
    const next = otherCurrency(currency);
    setChosen(next);
    AsyncStorage.setItem(HOME_CURRENCY_KEY, next).catch((err) =>
      logger.error('Home currency save error:', err)
    );
  }, [currency]);

  return { currency, switchCurrency };
}
