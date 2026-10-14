import type { ImageSourcePropType } from 'react-native';
import berry from '../assets/backgrounds/berry.jpg';
import desert from '../assets/backgrounds/desert.jpg';
import forest from '../assets/backgrounds/forest.jpg';
import night from '../assets/backgrounds/night.jpg';
import ocean from '../assets/backgrounds/ocean.jpg';
import sunrise from '../assets/backgrounds/sunrise.jpg';

export interface BackgroundMeta {
  id: string;
  name: string;
  source: ImageSourcePropType;
}

/** Bundled list/smart-list backgrounds (generated gradients, ~90KB each). */
export const BACKGROUNDS: BackgroundMeta[] = [
  { id: 'sunrise', name: 'Sunrise', source: sunrise },
  { id: 'ocean', name: 'Ocean', source: ocean },
  { id: 'forest', name: 'Forest', source: forest },
  { id: 'berry', name: 'Berry', source: berry },
  { id: 'desert', name: 'Desert', source: desert },
  { id: 'night', name: 'Night', source: night },
];

export function backgroundSource(id: string | null | undefined): ImageSourcePropType | null {
  return BACKGROUNDS.find((b) => b.id === id)?.source ?? null;
}
