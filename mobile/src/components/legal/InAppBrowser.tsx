import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView as RNWebView, type WebViewNavigation } from 'react-native-webview';
import type {
  IOSWebViewProps,
  WebViewHttpErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { makeStyles, useColors } from '../../theme';

/**
 * Our own pages (terms, privacy, support) open in a sheet inside the app
 * instead of throwing the person out to Safari mid sign-up. Anything that
 * leaves our site still opens in the system browser.
 *
 * The host is mounted once at the app root, outside navigation, so the
 * sign-in and consent screens can use it too.
 */

// The package's root props type intersects the iOS, Android and Windows prop
// types, which this TypeScript version reduces to `never`. The iOS props (the
// shared props plus the iOS extras used here) describe what we pass.
type BrowserWebViewProps = IOSWebViewProps & { ref?: React.Ref<WebViewHandle> };
interface WebViewHandle {
  reload: () => void;
}
const WebView = RNWebView as unknown as React.ComponentType<BrowserWebViewProps>;

const IN_APP_HOSTS = new Set(['zapppay.web.app']);

type Listener = (url: string) => void;
let listener: Listener | null = null;

function isInAppUrl(url: string): boolean {
  const m = /^https:\/\/([^/?#]+)/i.exec(url);
  return !!m && IN_APP_HOSTS.has(m[1].toLowerCase());
}

/** Opens our own pages in the in-app sheet; everything else in the system browser. */
export function openInAppBrowser(url: string): void {
  if (listener && isInAppUrl(url)) {
    listener(url);
    return;
  }
  Linking.openURL(url).catch(() => undefined);
}

export function InAppBrowserHost() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useStyles();
  const webRef = useRef<WebViewHandle>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listener = (next) => {
      // The phone-number keypad would otherwise sit on top of the sheet.
      Keyboard.dismiss();
      setTitle('');
      setFailed(false);
      setLoading(true);
      setCurrentUrl(next);
      setUrl(next);
    };
    return () => {
      listener = null;
    };
  }, []);

  const close = useCallback(() => setUrl(null), []);

  // Links inside the page that leave our site go to the system browser.
  const onShouldStart = useCallback((req: WebViewNavigation) => {
    if (req.url === 'about:blank' || isInAppUrl(req.url)) return true;
    Linking.openURL(req.url).catch(() => undefined);
    return false;
  }, []);

  const retry = () => {
    setFailed(false);
    setLoading(true);
    webRef.current?.reload();
  };

  return (
    <Modal
      visible={url !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={close}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.closeText}>{t('common.close')}</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {title || 'Zapp Pay'}
          </Text>
          <TouchableOpacity
            onPress={() => currentUrl && Linking.openURL(currentUrl).catch(() => undefined)}
            style={[styles.headerBtn, styles.headerBtnRight]}
            accessibilityRole="button"
            accessibilityLabel={t('legal.openInBrowser')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.externalIcon}>↗</Text>
          </TouchableOpacity>
        </View>

        {url ? (
          <View style={styles.body}>
            {failed ? (
              <View style={styles.center}>
                <Text style={styles.errorTitle}>{t('legal.loadError')}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={retry} accessibilityRole="button">
                  <Text style={styles.retryText}>{t('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <WebView
              ref={webRef}
              source={{ uri: url }}
              style={[styles.web, failed && styles.hidden]}
              originWhitelist={['https://*']}
              onShouldStartLoadWithRequest={onShouldStart}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={(e: { nativeEvent: { title?: string } }) => {
                setLoading(false);
                // The title is only final once the page has loaded.
                const pageTitle = e.nativeEvent.title;
                if (pageTitle && !/^https?:/.test(pageTitle)) setTitle(pageTitle);
              }}
              onNavigationStateChange={(nav: WebViewNavigation) => {
                if (nav.url) setCurrentUrl(nav.url);
                // onLoadEnd keeps the first page's title after a link is
                // followed, so take it from here once the new page is done.
                if (!nav.loading && nav.title && !/^https?:/.test(nav.title)) {
                  setTitle(nav.title);
                }
              }}
              onError={() => {
                setFailed(true);
                setLoading(false);
              }}
              onHttpError={(e: WebViewHttpErrorEvent) => {
                if (e.nativeEvent.statusCode >= 400) setFailed(true);
              }}
              // Our pages need no storage of their own, and nothing from the
              // app's session should be visible to them.
              incognito
              sharedCookiesEnabled={false}
              allowsBackForwardNavigationGestures
            />
            {loading && !failed ? (
              <View style={styles.loading} pointerEvents="none">
                <ActivityIndicator color={colors.ui.accent} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.ui.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ui.divider,
  },
  headerBtn: { minWidth: 64, minHeight: 32, justifyContent: 'center' },
  headerBtnRight: { alignItems: 'flex-end' },
  closeText: { color: colors.ui.accentText, fontSize: 16, fontWeight: '600' },
  externalIcon: { color: colors.ui.textDim, fontSize: 20 },
  title: {
    flex: 1,
    textAlign: 'center',
    color: colors.ui.text,
    fontSize: 16,
    fontWeight: '600',
  },
  body: { flex: 1, backgroundColor: '#FFFFFF' },
  web: { flex: 1 },
  hidden: { opacity: 0, height: 0, flex: 0 },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.ui.canvas,
  },
  errorTitle: { color: colors.ui.text, fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: colors.ui.accent,
  },
  retryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
}));
