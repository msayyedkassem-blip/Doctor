import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { getApiUrl, setApiUrl } from '~/lib/api';
import { useCatalogue } from '~/lib/catalogue';
import { theme } from '~/lib/theme';

/**
 * Server address, editable in the app.
 *
 * A sideloaded APK is built before the backend has a public URL. Baking the
 * address in would mean rebuilding and reinstalling the moment the shop is
 * deployed; editing it here means the same APK keeps working.
 */
export default function SettingsScreen() {
  const { catalogue, source, error, refresh, loading } = useCatalogue();
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { void getApiUrl().then(setUrl); }, []);

  const sourceLabel = {
    network: 'Serveur — données à jour',
    cache: 'Cache local — dernière synchronisation réussie',
    bundled: 'Catalogue embarqué dans l\'application',
  }[source ?? 'bundled'];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
      <View style={s.card}>
        <Text style={s.heading}>Connexion</Text>
        <Text style={s.label}>Adresse du serveur</Text>
        <TextInput
          value={url}
          onChangeText={(v) => { setUrl(v); setSaved(false); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://..."
          placeholderTextColor={theme.muted}
          style={s.input}
        />
        <Text style={s.hint}>
          Laisser vide pour revenir à l'adresse par défaut. Sur émulateur Android,
          l'ordinateur hôte est 10.0.2.2.
        </Text>

        <Pressable
          style={s.button}
          onPress={async () => {
            await setApiUrl(url);
            await refresh();
            setSaved(true);
          }}
        >
          <Text style={s.buttonText}>{loading ? 'Connexion…' : 'Enregistrer et synchroniser'}</Text>
        </Pressable>
        {saved && !loading && (
          <Text style={[s.hint, { color: source === 'network' ? theme.good : theme.sumac }]}>
            {source === 'network' ? 'Connecté au serveur.' : `Serveur injoignable${error ? ` (${error})` : ''}.`}
          </Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.heading}>Catalogue</Text>
        <Text style={s.row}>{sourceLabel}</Text>
        <Text style={s.row}>{catalogue?.products.length ?? 0} produits</Text>
        {catalogue?.generatedAt && (
          <Text style={s.row}>
            Généré le {new Date(catalogue.generatedAt).toLocaleString('fr-FR')}
          </Text>
        )}
        <Pressable style={[s.button, s.buttonAlt]} onPress={() => void refresh()}>
          <Text style={[s.buttonText, { color: theme.ink }]}>Rafraîchir</Text>
        </Pressable>
      </View>

      {catalogue?.operator && (
        <View style={s.card}>
          <Text style={s.heading}>Exploitant</Text>
          <Text style={s.row}>
            {catalogue.operator.legalName}
            {'\n'}{catalogue.operator.addressLine1}
            {'\n'}{catalogue.operator.postalCode} {catalogue.operator.city}
          </Text>
          {catalogue.operator.citeoIdu && (
            <Text style={s.row}>Identifiant unique REP : {catalogue.operator.citeoIdu}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: theme.white, borderRadius: 14,
    borderWidth: 1, borderColor: theme.line, padding: 16,
  },
  heading: { fontSize: 17, fontWeight: '700', color: theme.ink, marginBottom: 10 },
  label: { fontSize: 13, fontWeight: '600', color: theme.ink },
  input: {
    borderWidth: 1, borderColor: theme.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 6,
    fontSize: 14, color: theme.ink, backgroundColor: theme.cream,
  },
  hint: { fontSize: 12, color: theme.muted, marginTop: 8, lineHeight: 17 },
  row: { fontSize: 13, color: theme.muted, marginTop: 4, lineHeight: 19 },
  button: {
    backgroundColor: theme.olive, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', marginTop: 14,
  },
  buttonAlt: { backgroundColor: theme.cream, borderWidth: 1, borderColor: theme.line },
  buttonText: { color: theme.cream, fontWeight: '700', fontSize: 14 },
});
