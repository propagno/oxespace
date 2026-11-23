/**
 * What the preload's sendTyped and steerTyped append: the person just typed this text. It is the only thing that gives
 * a send or steer from the window the authority to run one of the commands in threadDesktopCommands.ts.
 * A module of its own, so the preload bundles this string and not the command lists.
 */
export const THREAD_TEXT_TYPED = 'typed'
