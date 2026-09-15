import { useState } from 'react';
import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import {
  ALLERGEN_LABELS, formatCents, withdrawalRight, WITHDRAWAL_PERIOD_DAYS,
} from '@souk/core';
import { useCatalogue } from '~/lib/catalogue';
import { useCart } from '~/lib/cart';
import { theme } from '~/lib/theme';

const num = (v: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.incoRow}>
      <Text style={s.incoLabel}>{label}</Text>
      <View style={{ marginTop: 3 }}>{children}</View>
    </View>
  );
}

/** Renders **allergen** emphasis as bold, per INCO art. 21. */
function Ingredients({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={s.incoValue}>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <Text key={i} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { catalogue } = useCatalogue();
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  const product = catalogue?.products.find((p) => p.slug === slug);

  if (!product) {
    return (
      <View style={s.center}>
        <Text style={{ color: theme.muted }}>Produit introuvable.</Text>
      </View>
    );
  }

  const n = product.nutrition;
  const perUnit = product.netQuantityUnit === 'ML' || product.netQuantityUnit === 'L' ? '100 ml' : '100 g';
  const unitLabel: Record<string, string> = { G: 'g', KG: 'kg', ML: 'ml', L: 'l', PIECE: 'pièce(s)' };

  const returns = withdrawalRight({
    durabilityKind: product.durabilityKind,
    sealBroken: false,
    deliveredAt: new Date(),
  });

  const nutritionRows: [string, string, boolean][] = [
    ['Énergie', `${num(Math.round(n.energyKj))} kJ / ${num(Math.round(n.energyKcal))} kcal`, false],
    ['Matières grasses', `${num(n.fat)} g`, false],
    ['dont acides gras saturés', `${num(n.saturates)} g`, true],
    ['Glucides', `${num(n.carbohydrate)} g`, false],
    ['dont sucres', `${num(n.sugars)} g`, true],
    ...(n.fibre !== null ? ([['Fibres alimentaires', `${num(n.fibre)} g`, false]] as [string, string, boolean][]) : []),
    ['Protéines', `${num(n.protein)} g`, false],
    ['Sel', `${num(n.salt)} g`, false],
  ];

  return (
    <>
      <Stack.Screen options={{ title: product.displayNameFr }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={s.title}>{product.displayNameFr}</Text>
        <Text style={s.legal}>{product.legalName}</Text>

        <Text style={s.price}>{formatCents(product.priceCents)}</Text>
        <Text style={s.qty}>
          {num(product.netQuantityValue)} {unitLabel[product.netQuantityUnit] ?? ''}
          {product.brand ? ` · ${product.brand}` : ''}
        </Text>

        {product.descriptionFr ? <Text style={s.desc}>{product.descriptionFr}</Text> : null}

        <Pressable
          style={[s.cta, !product.inStock && s.ctaOff]}
          disabled={!product.inStock}
          onPress={() => {
            add(product.id, 1);
            setAdded(true);
            setTimeout(() => setAdded(false), 1600);
          }}
        >
          <Text style={s.ctaText}>
            {!product.inStock ? 'Épuisé' : added ? 'Ajouté ✓' : 'Ajouter au panier'}
          </Text>
        </Pressable>

        <Text style={s.note}>
          Expédié depuis la France · Origine {product.countryOfOrigin}
        </Text>
        <Text style={s.note}>
          {returns.applies
            ? `Rétractation sous ${WITHDRAWAL_PERIOD_DAYS} jours si le produit est encore scellé.`
            : returns.explanationFr}
        </Text>

        {/*
          Art. 14 applies to the app exactly as it does to the website: every
          mandatory particular except the durability date must be available
          before the purchase is concluded.
        */}
        <Text style={s.incoHeading}>Informations réglementaires</Text>
        <Text style={s.incoSub}>Règlement (UE) n° 1169/2011</Text>

        <Row label="Dénomination légale de vente">
          <Text style={s.incoValue}>{product.legalName}</Text>
        </Row>

        <Row label="Liste des ingrédients">
          <Ingredients text={product.ingredientsFr} />
          {product.quidFr ? <Text style={s.incoMuted}>{product.quidFr}</Text> : null}
        </Row>

        <Row label="Allergènes">
          {product.allergens.length === 0 && product.mayContain.length === 0 ? (
            <Text style={s.incoMuted}>Aucun des 14 allergènes à déclaration obligatoire.</Text>
          ) : (
            <>
              {product.allergens.length > 0 && (
                <Text style={[s.incoValue, { color: theme.sumac }]}>
                  Contient : {product.allergens.map((a) => ALLERGEN_LABELS[a].fr).join(', ')}
                </Text>
              )}
              {product.mayContain.length > 0 && (
                <Text style={s.incoMuted}>
                  Peut contenir des traces de :{' '}
                  {product.mayContain.map((a) => ALLERGEN_LABELS[a].fr).join(', ')}
                </Text>
              )}
            </>
          )}
        </Row>

        <Row label="Quantité nette">
          <Text style={s.incoValue}>
            {num(product.netQuantityValue)} {unitLabel[product.netQuantityUnit] ?? ''}
            {product.netQuantityDrained
              ? ` (poids net égoutté ${num(product.netQuantityDrained)} ${unitLabel[product.netQuantityUnit] ?? ''})`
              : ''}
          </Text>
        </Row>

        <Row label={`Déclaration nutritionnelle — pour ${perUnit}`}>
          <View style={{ marginTop: 4 }}>
            {nutritionRows.map(([label, value, indent]) => (
              <View key={label} style={s.nutriRow}>
                <Text style={[s.nutriLabel, indent && { paddingLeft: 14, color: theme.muted }]}>
                  {label}
                </Text>
                <Text style={s.nutriValue}>{value}</Text>
              </View>
            ))}
          </View>
        </Row>

        <Row label="Conditions de conservation">
          <Text style={s.incoValue}>{product.storageConditionsFr}</Text>
        </Row>

        {product.usageInstructionsFr ? (
          <Row label="Conseils d'utilisation">
            <Text style={s.incoValue}>{product.usageInstructionsFr}</Text>
          </Row>
        ) : null}

        <Row label="Pays d'origine">
          <Text style={s.incoValue}>{product.countryOfOrigin}</Text>
        </Row>

        <Row label="Exploitant du secteur alimentaire">
          {catalogue?.operator ? (
            <>
              <Text style={s.incoValue}>
                {catalogue.operator.legalName}
                {'\n'}{catalogue.operator.addressLine1}
                {'\n'}{catalogue.operator.postalCode} {catalogue.operator.city}, {catalogue.operator.country}
              </Text>
              <Text style={s.incoMuted}>
                Importateur responsable de la conformité de la denrée dans l'Union européenne.
              </Text>
            </>
          ) : (
            <Text style={s.incoMuted}>—</Text>
          )}
        </Row>

        <Row label="Date de durabilité">
          <Text style={s.incoMuted}>
            {product.durabilityKind === 'DDM'
              ? "La date de durabilité minimale figure sur l'emballage du produit livré."
              : "La date limite de consommation figure sur l'emballage du produit livré."}
          </Text>
        </Row>

        <Pressable onPress={() => router.push('/panier')} style={s.secondary}>
          <Text style={s.secondaryText}>Voir le panier</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 23, fontWeight: '700', color: theme.ink },
  legal: { fontSize: 13, color: theme.muted, marginTop: 3 },
  price: { fontSize: 27, fontWeight: '700', color: theme.ink, marginTop: 14 },
  qty: { fontSize: 13, color: theme.muted, marginTop: 2 },
  desc: { fontSize: 15, color: theme.ink, marginTop: 14, lineHeight: 22 },
  cta: {
    backgroundColor: theme.olive, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', marginTop: 20,
  },
  ctaOff: { backgroundColor: theme.line },
  ctaText: { color: theme.cream, fontWeight: '700', fontSize: 15 },
  note: { fontSize: 12, color: theme.muted, marginTop: 10 },
  incoHeading: { fontSize: 19, fontWeight: '700', color: theme.ink, marginTop: 30 },
  incoSub: { fontSize: 12, color: theme.muted, marginTop: 2, marginBottom: 6 },
  incoRow: { borderTopWidth: 1, borderTopColor: theme.line, paddingVertical: 12 },
  incoLabel: { fontSize: 12, fontWeight: '700', color: theme.muted },
  incoValue: { fontSize: 14, color: theme.ink, lineHeight: 21 },
  incoMuted: { fontSize: 13, color: theme.muted, marginTop: 4, lineHeight: 19 },
  nutriRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: theme.line, paddingVertical: 5,
  },
  nutriLabel: { fontSize: 14, color: theme.ink, flex: 1 },
  nutriValue: { fontSize: 14, color: theme.ink, fontVariant: ['tabular-nums'] },
  secondary: {
    marginTop: 24, borderWidth: 1, borderColor: theme.line, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center', backgroundColor: theme.white,
  },
  secondaryText: { color: theme.ink, fontWeight: '600' },
});
