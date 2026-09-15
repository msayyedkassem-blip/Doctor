import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useCart } from '~/lib/cart';
import { theme } from '~/lib/theme';

/**
 * A real native tab bar, not a web header in a shell. This is one of the
 * things that separates an app from a repackaged website under Apple's
 * Guideline 4.2 — and it is simply better to use on a phone.
 */
function CartBadge({ color }: { color: string }) {
  const { itemCount } = useCart();
  return (
    <View>
      <Text style={{ color, fontSize: 20 }}>🧺</Text>
      {itemCount > 0 && (
        <View
          style={{
            position: 'absolute', top: -4, right: -10,
            minWidth: 18, height: 18, borderRadius: 9,
            backgroundColor: theme.olive,
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: theme.cream, fontSize: 11, fontWeight: '700' }}>{itemCount}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.oliveDark,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { backgroundColor: theme.cream, borderTopColor: theme.line },
        headerStyle: { backgroundColor: theme.cream },
        headerTintColor: theme.ink,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Boutique',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🛍️</Text>,
        }}
      />
      <Tabs.Screen
        name="panier"
        options={{
          title: 'Panier',
          tabBarIcon: ({ color }) => <CartBadge color={color} />,
        }}
      />
      <Tabs.Screen
        name="reglages"
        options={{
          title: 'Réglages',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙️</Text>,
        }}
      />
    </Tabs>
  );
}
