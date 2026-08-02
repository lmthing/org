import * as Prim from '../../elements/primitives/index';

/**
 * The two panes that only exist because the surface became addressable.
 *
 * Once a conversation has a URL, a URL can be WRONG — bookmarked after the chat was deleted, typed
 * with a fat finger, shared by a teammate whose project you cannot see — and it can be SLOW, because
 * a cold deep link has to rehydrate the session from its snapshot before there is a transcript to
 * draw. Neither state existed while the surface was one route: you could only reach a conversation
 * by clicking one that was listed, and it was already live when you clicked it.
 *
 * Both panes are rendered INSIDE the shell, next to the sidebar, so every one of them still has the
 * conversation list and the project switcher on screen. A full-page error would be the one thing
 * worse than the blank screen it replaces: correct, and impossible to leave.
 */

export interface MissingPaneAction {
  label: string;
  onPress: () => void;
  /** The one obvious way forward, filled in the primary colour. At most one per pane. */
  primary?: boolean;
}

interface MissingPaneProps {
  title: string;
  detail: string;
  actions: MissingPaneAction[];
}

/** What the URL named is not there. Says so, and offers the ways out. */
export function MissingPane({ title, detail, actions }: MissingPaneProps) {
  return (
    <Prim.Col
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      flexShrink={1}
      flexBasis="0%"
      paddingHorizontal="$6"
      gap="$3"
    >
      <Prim.Text fontSize="$base" fontWeight="$medium" color="$foreground" textAlign="center">
        {title}
      </Prim.Text>
      <Prim.Text fontSize="$sm" color="$muted-foreground" textAlign="center">
        {detail}
      </Prim.Text>
      <Prim.Row gap="$2" marginTop="$2" flexWrap="wrap" justifyContent="center">
        {actions.map((action) => (
          <Prim.Pressable
            key={action.label}
            onClick={action.onPress}
            display="flex"
            alignItems="center"
            justifyContent="center"
            paddingHorizontal="$4"
            paddingVertical="$2"
            borderRadius="$radius-xl"
            borderWidth={action.primary ? 0 : 1}
            borderColor="$border"
            {...(action.primary ? { backgroundColor: '$primary' } : {})}
            // Restated on the Pressable as well as the label: a native `Text` does not inherit
            // colour through a `View`, so the label alone comes out in the default foreground on a
            // device — dark type on the primary fill, the one pair the tokens exist to prevent.
            color={action.primary ? '$primary-foreground' : '$foreground'}
            hoverStyle={action.primary ? { opacity: 0.9 } : { backgroundColor: '$muted' }}
          >
            <Prim.Text
              color={action.primary ? '$primary-foreground' : '$foreground'}
              fontSize="$sm"
              fontWeight={action.primary ? '$medium' : '$normal'}
            >
              {action.label}
            </Prim.Text>
          </Prim.Pressable>
        ))}
      </Prim.Row>
    </Prim.Col>
  );
}

/**
 * A conversation named by the URL is being rehydrated.
 *
 * Without this the deep link showed `NoSessionPane` — "No conversation open", with a New chat
 * button — for the whole of the resume, which is both false and actively dangerous: the obvious
 * button on it starts a DIFFERENT conversation over the one that was still loading.
 */
export function OpeningPane() {
  return (
    <Prim.Col
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      flexShrink={1}
      flexBasis="0%"
      paddingHorizontal="$6"
    >
      <Prim.Text fontSize="$sm" color="$muted-foreground" textAlign="center">
        Opening conversation…
      </Prim.Text>
    </Prim.Col>
  );
}
