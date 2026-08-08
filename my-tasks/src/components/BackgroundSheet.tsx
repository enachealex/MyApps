import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { BACKGROUNDS } from '../backgrounds';
import { ThemeColors, useThemedStyles } from '../theme';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  current: string | null;
  onSelect: (background: string | null) => void;
}

export function BackgroundSheet({ visible, onClose, current, onSelect }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);

  const pick = (id: string | null) => {
    onSelect(id);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Background">
      <View style={styles.grid}>
        <Pressable style={styles.cell} onPress={() => pick(null)}>
          <View style={[styles.thumb, styles.noneThumb, current == null && styles.thumbSelected]}>
            <Ionicons name="ban-outline" size={22} color={colors.textTertiary} />
          </View>
          <Text style={styles.label}>None</Text>
        </Pressable>
        {BACKGROUNDS.map((bg) => (
          <Pressable key={bg.id} style={styles.cell} onPress={() => pick(bg.id)}>
            <View style={[styles.thumb, current === bg.id && styles.thumbSelected]}>
              <Image source={bg.source} style={styles.thumbImage} resizeMode="cover" />
              {current === bg.id && (
                <View style={styles.checkBadge}>
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
              )}
            </View>
            <Text style={styles.label}>{bg.name}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 14,
      paddingHorizontal: 20,
      paddingBottom: 6,
    },
    cell: {
      alignItems: 'center',
      width: 72,
    },
    thumb: {
      width: 68,
      height: 92,
      borderRadius: 10,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    noneThumb: {
      borderColor: colors.border,
      borderStyle: 'dashed',
    },
    thumbSelected: {
      borderColor: colors.primary,
    },
    thumbImage: {
      width: '100%',
      height: '100%',
    },
    checkBadge: {
      position: 'absolute',
      top: 5,
      right: 5,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 5,
    },
  });
