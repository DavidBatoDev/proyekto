declare module "emoji-picker-react" {
  import type { ComponentType } from "react";

  export type EmojiClickData = {
    emoji: string;
  };

  export enum Theme {
    LIGHT = "light",
    DARK = "dark",
    AUTO = "auto",
  }

  export interface EmojiPickerProps {
    onEmojiClick?: (emojiData: EmojiClickData, event?: MouseEvent) => void;
    width?: number | string;
    height?: number | string;
    theme?: Theme;
    searchDisabled?: boolean;
    skinTonesDisabled?: boolean;
    lazyLoadEmojis?: boolean;
  }

  const EmojiPicker: ComponentType<EmojiPickerProps>;
  export default EmojiPicker;
}
