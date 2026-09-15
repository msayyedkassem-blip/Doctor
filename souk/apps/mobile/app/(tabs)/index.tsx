import { useMemo, useState } from 'react';
import {
  FlatList, Pressable, RefreshControl, ScrollView, Text, View, StyleSheet,
} from 'react-native';
import { Link } from 'expo-router';
import { ALLERGEN_LABELS, formatCents } from '@souk/core';
import { useCatalogue } from '~/lib/catalogue';
import { theme } from '~/lib/theme';
import type { ApiProduct } from '~/lib/types';

function Thumb({ name }: { name: string }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <View style={[s.thumb, { backgroundColor: `hsl(${hue}, 28%, 88%)` }]}>
      <Text style={{ fontSize: 30, color: `hsl(${hue}, 40%, 30%)`, opacity: 0.5 }}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

function ProductRow({ product }: { product: ApiProduct }) {
  return (
    <Link href={`/produit/${product.slug}`} asChild>
      <Pressable style={s.row}>
        <Thumb name={product.displayNameFr} />
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{product.displayNameFr}</Text>
          {product.allergens.length > 0 && (
            <Text style={s.allergens} numberOfLines={1}>
              Contient : {product.allergens.map((a) => ALLERGEN_LABELS[a].fr).join(', ')}
            </Text>
          )}
          <Text style={s.price}>{formatCents(product.priceCents)}</Text>
        </View>
        {!product.inStock && <Text style={s.oos}>Épuisé</Text>}
      </Pressable>
    </Link>
  );
}

export default function ShopScreen() {
  const { catalogue, loading, refresh, source, error } = useCatalogue();
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const products = useMemo(() => {
    const all = catalogue?.products ?? [];
    return categoryId ? all.filter((p) => p.categoryId === categoryId) : all;
  }, [catalogue, categoryId]);

  const categories = catalogue?.categories ?? [];

  return (
    <View style={{ flex: 1 }}>
      {source !== 'network' && (
        <View style={s.offline}>
          <Text style={s.offlineText}>
            {source === 'cache'
              ? 'Catalogue hors ligne — dernière synchronisation enregistrée.'
              : 'Catalogue embarqué — serveur injoignable.'}
            {error ? ` (${error})` : ''}
          </Text>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.filters}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}
      >
        <Pressable onPress={() => setCategoryId(null)} style={[s.chip, !categoryId && s.chipOn]}>
          <Text style={[s.chipText, !categoryId && s.chipTextOn]}>Tout</Text>
        </Pressable>
        {categories.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setCategoryId(c.id)}
            style={[s.chip, categoryId === c.id && s.chipOn]}
          >
            <Text style={[s.chipText, categoryId === c.id && s.chipTextOn]}>{c.nameFr}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <ProductRow product={item} />}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={theme.olive} />
        }
        ListEmptyComponent={
          <Text style={{ color: theme.muted, textAlign: 'center', marginTop: 40 }}>
            Aucun produit dans ce rayon.
          </Text>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  offline: { backgroundColor: theme.parchment, paddingHorizontal: 14, paddingVertical: 8 },
  offlineText: { color: theme.muted, fontSize: 12 },
  filters: { flexGrow: 0, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: theme.line, backgroundColor: theme.white,
  },
  chipOn: { backgroundColor: theme.olive, borderColor: theme.olive },
  chipText: { color: theme.muted, fontSize: 13 },
  chipTextOn: { color: theme.cream },
  row: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: theme.white, borderRadius: 14, padding: 10,
    borderWidth: 1, borderColor: theme.line,
  },
  thumb: { width: 62, height: 62, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '600', color: theme.ink },
  allergens: { fontSize: 11, color: theme.muted, marginTop: 2 },
  price: { fontSize: 16, fontWeight: '700', color: theme.ink, marginTop: 4 },
  oos: { fontSize: 11, color: theme.sumac },
});
