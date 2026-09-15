import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { FRANCHISE_INVOICE_MENTION, FREE_SHIPPING_THRESHOLD, formatCents } from '@souk/core';
import { useCart } from '~/lib/cart';
import { useCatalogue } from '~/lib/catalogue';
import { theme } from '~/lib/theme';

const num = (v: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v);

export default function CartScreen() {
  const { totals, shippingOptions, setQuantity, clear } = useCart();
  const { catalogue } = useCatalogue();
  const vatMode = catalogue?.vatMode ?? 'FRANCHISE';

  if (totals.lines.length === 0) {
    return (
      <View style={s.center}>
        <Text style={{ fontSize: 17, color: theme.ink }}>Votre panier est vide</Text>
        <Pressable onPress={() => router.push('/')} style={s.cta}>
          <Text style={s.ctaText}>Parcourir la boutique</Text>
        </Pressable>
      </View>
    );
  }

  const missing = FREE_SHIPPING_THRESHOLD !== null
    ? FREE_SHIPPING_THRESHOLD - totals.subtotalCents
    : 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
      {totals.lines.map((line) => (
        <View key={line.productId} style={s.line}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{line.nameFr}</Text>
            <Text style={s.unit}>{formatCents(line.unitPriceCents)} l'unité</Text>

            <View style={s.stepper}>
              <Pressable
                onPress={() => setQuantity(line.productId, line.quantity - 1)}
                style={s.stepBtn}
                accessibilityLabel="Diminuer la quantité"
              >
                <Text style={s.stepText}>−</Text>
              </Pressable>
              <Text style={s.qty}>{line.quantity}</Text>
              <Pressable
                onPress={() => setQuantity(line.productId, line.quantity + 1)}
                style={s.stepBtn}
                accessibilityLabel="Augmenter la quantité"
              >
                <Text style={s.stepText}>+</Text>
              </Pressable>
              <Pressable onPress={() => setQuantity(line.productId, 0)} style={{ marginLeft: 12 }}>
                <Text style={s.remove}>Retirer</Text>
              </Pressable>
            </View>
          </View>
          <Text style={s.lineTotal}>{formatCents(line.lineTotalCents)}</Text>
        </View>
      ))}

      <View style={s.summary}>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Sous-total</Text>
          <Text style={s.sumValue}>{formatCents(totals.subtotalCents)}</Text>
        </View>
        <View style={s.sumRow}>
          <Text style={s.sumLabel}>Poids</Text>
          <Text style={s.sumValue}>{num(totals.itemsWeightGrams / 1000)} kg</Text>
        </View>

        {missing > 0 && (
          <Text style={s.freeShip}>
            Plus que {formatCents(missing)} pour la livraison offerte en Point Relais.
          </Text>
        )}

        <Text style={s.shipHeading}>Livraison estimée</Text>
        {shippingOptions.map((q) => (
          <View key={q.method} style={s.sumRow}>
            <Text style={s.sumLabel}>
              {q.labelFr}
              {'\n'}
              <Text style={{ fontSize: 11 }}>J+{q.minBusinessDays}–{q.maxBusinessDays}</Text>
            </Text>
            <Text style={s.sumValue}>{q.isFree ? 'Offerte' : formatCents(q.priceCents)}</Text>
          </View>
        ))}

        <View style={[s.sumRow, s.totalRow]}>
          <Text style={s.totalLabel}>Total articles</Text>
          <Text style={s.totalValue}>{formatCents(totals.subtotalCents)}</Text>
        </View>

        {/* No VAT line may be shown while the franchise applies. */}
        {vatMode === 'FRANCHISE' ? (
          <Text style={s.legalMention}>{FRANCHISE_INVOICE_MENTION}</Text>
        ) : (
          totals.vatBreakdown.map((r) => (
            <View key={r.rateBasisPoints} style={s.sumRow}>
              <Text style={s.sumLabel}>Dont TVA {(r.rateBasisPoints / 100).toFixed(1)} %</Text>
              <Text style={s.sumValue}>{formatCents(r.vatCents)}</Text>
            </View>
          ))
        )}
      </View>

      <Pressable style={[s.cta, { marginTop: 18 }]} onPress={() => {}}>
        <Text style={s.ctaText}>Passer commande</Text>
      </Pressable>
      <Text style={s.soon}>Le paiement sera disponible dans une prochaine version.</Text>

      <Pressable onPress={clear} style={{ marginTop: 20, alignItems: 'center' }}>
        <Text style={s.remove}>Vider le panier</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  line: {
    flexDirection: 'row', gap: 12, backgroundColor: theme.white,
    borderRadius: 14, borderWidth: 1, borderColor: theme.line, padding: 12, marginBottom: 10,
  },
  name: { fontSize: 15, fontWeight: '600', color: theme.ink },
  unit: { fontSize: 12, color: theme.muted, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  stepBtn: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: theme.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cream,
  },
  stepText: { fontSize: 17, color: theme.ink },
  qty: { minWidth: 34, textAlign: 'center', fontSize: 15, color: theme.ink },
  remove: { fontSize: 13, color: theme.muted, textDecorationLine: 'underline' },
  lineTotal: { fontSize: 15, fontWeight: '700', color: theme.ink },
  summary: {
    backgroundColor: theme.white, borderRadius: 14, borderWidth: 1,
    borderColor: theme.line, padding: 14, marginTop: 6,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  sumLabel: { fontSize: 13, color: theme.muted, flex: 1 },
  sumValue: { fontSize: 13, color: theme.ink, fontVariant: ['tabular-nums'] },
  freeShip: {
    fontSize: 12, color: theme.muted, backgroundColor: theme.parchment,
    padding: 10, borderRadius: 10, marginTop: 8,
  },
  shipHeading: {
    fontSize: 13, fontWeight: '700', color: theme.ink,
    marginTop: 14, borderTopWidth: 1, borderTopColor: theme.line, paddingTop: 12,
  },
  totalRow: { borderTopWidth: 1, borderTopColor: theme.line, marginTop: 10, paddingTop: 12 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: theme.ink },
  totalValue: { fontSize: 16, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  legalMention: { fontSize: 11, color: theme.muted, marginTop: 8 },
  cta: { backgroundColor: theme.olive, borderRadius: 12, paddingVertical: 15, alignItems: 'center', paddingHorizontal: 24 },
  ctaText: { color: theme.cream, fontWeight: '700', fontSize: 15 },
  soon: { fontSize: 11, color: theme.muted, textAlign: 'center', marginTop: 8 },
});
