import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CatalogueProvider, useCatalogue } from '~/lib/catalogue';
import { CartProvider } from '~/lib/cart';
import { theme } from '~/lib/theme';

function WithCart({ children }: { children: React.ReactNode }) {
  const { catalogue, loading } = useCatalogue();

  if (loading && !catalogue) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cream }}>
        <ActivityIndicator color={theme.olive} />
      </View>
    );
  }

  return (
    <CartProvider
      products={catalogue?.products ?? []}
      vatMode={catalogue?.vatMode ?? 'FRANCHISE'}
    >
      {children}
    </CartProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <CatalogueProvider>
        <WithCart>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.cream },
              headerTintColor: theme.ink,
              headerTitleStyle: { fontWeight: '600' },
              contentStyle: { backgroundColor: theme.cream },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="produit/[slug]" options={{ title: '' }} />
          </Stack>
        </WithCart>
      </CatalogueProvider>
    </SafeAreaProvider>
  );
}
