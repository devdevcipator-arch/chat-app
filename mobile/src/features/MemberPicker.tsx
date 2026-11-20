import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ProfileRepo } from "../data/profiles";
import { isValidUsername, normalizeUsername } from "../lib/username";
import { type Profile, avatarImageUrl, profileName } from "../models/types";
import { Avatar, Button, IconButton, Spinner } from "../ui/components";
import { Text, TextInput } from "../ui/Text";
import { usePalette } from "../ui/theme";

const EMPTY: ReadonlySet<string> = new Set();

/** Exact @username lookup that adds people to a selection (new group, add members). */
export function MemberPicker({
  meId,
  selected,
  onChange,
  excludeIds = EMPTY,
}: {
  meId: string;
  selected: Profile[];
  onChange: (next: Profile[]) => void;
  excludeIds?: ReadonlySet<string>;
}) {
  const c = usePalette();
  // Keyed on the contents, so a parent re-creating the Set doesn't restart the lookup.
  const excludeKey = [...excludeIds].sort().join(",");
  const [username, setUsername] = useState("");
  const [found, setFound] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setFound(null);
    setMessage(null);
    if (!isValidUsername(username)) return setSearching(false);
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      let msg: string | null = null;
      let hit: Profile | null = null;
      try {
        const p = await ProfileRepo.findByUsername(username);
        if (!p) msg = `No one goes by @${username}.`;
        else if (p.id === meId) msg = "That's you.";
        else if (excludeKey.split(",").includes(p.id)) msg = `${profileName(p)} is already in the group.`;
        else hit = p;
      } catch {
        msg = "Search failed. Try again.";
      }
      if (cancelled) return;
      setSearching(false);
      setFound(hit);
      setMessage(msg);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username, meId, excludeKey]);

  const add = (p: Profile) => {
    if (!selected.some((s) => s.id === p.id)) onChange([...selected, p]);
    setUsername("");
  };

  return (
    <View>
      <View style={[styles.input, { borderColor: c.border, backgroundColor: c.surface }]}>
        <Text muted style={{ fontSize: 16 }}>
          @
        </Text>
        <TextInput
          value={username}
          onChangeText={(t) => setUsername(normalizeUsername(t))}
          placeholder="Add people by exact username"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, height: "100%", fontSize: 16, marginLeft: 4 }}
          accessibilityLabel="Add people by exact username"
        />
        {searching ? <Spinner /> : null}
      </View>
      {message ? (
        <Text muted style={{ marginTop: 8 }}>
          {message}
        </Text>
      ) : null}
      {found ? (
        <View style={styles.found}>
          <Avatar name={profileName(found)} uri={avatarImageUrl(found)} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontWeight: "500" }} numberOfLines={1}>
              {profileName(found)}
            </Text>
            <Text muted style={{ fontSize: 13 }}>
              @{found.username}
            </Text>
          </View>
          <Button title="Add" variant="tonal" compact onPress={() => add(found)} />
        </View>
      ) : null}
      {selected.length ? (
        <View style={styles.chips}>
          {selected.map((p) => (
            <View key={p.id} style={[styles.chip, { backgroundColor: c.surfaceHigh }]}>
              <Avatar name={profileName(p)} uri={avatarImageUrl(p)} size={24} />
              <Text style={{ marginHorizontal: 6, fontSize: 14 }} numberOfLines={1}>
                {profileName(p)}
              </Text>
              <IconButton
                name="close"
                size={16}
                label={`Remove ${profileName(p)}`}
                onPress={() => onChange(selected.filter((s) => s.id !== p.id))}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  found: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { flexDirection: "row", alignItems: "center", borderRadius: 20, paddingLeft: 4, height: 34, maxWidth: "100%" },
});
