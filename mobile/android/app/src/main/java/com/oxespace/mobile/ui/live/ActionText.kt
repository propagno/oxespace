package com.oxespace.mobile.ui.live

import com.oxespace.mobile.R
import com.oxespace.mobile.approval.Presence
import com.oxespace.mobile.protocol.RemoteErrorCode
import com.oxespace.mobile.protocol.live.CommandResult

/**
 * The clientId of the next send. The desktop applies a clientId once and replays its result, failures too: while a
 * message's fate is unknown (no answer, offline) the same id makes a resend safe; after it went through or was
 * refused, the next try is a new message.
 */
fun clientIdAfter(result: CommandResult, current: String, newId: () -> String): String = when (result) {
    is CommandResult.Done, is CommandResult.Refused -> newId()
    CommandResult.NoAnswer, CommandResult.Offline -> current
}

/** A message sent without an answer, exactly as it went: its text and whether it steered a running turn. */
data class Outgoing(val text: String, val steer: Boolean)

/**
 * What a send carries. While the field still holds exactly the unsent message, it goes again as it first went (same
 * mode, and the caller keeps its clientId); otherwise it is what the field holds now, as a message or a steer.
 */
fun outgoingFor(unsent: Outgoing?, field: String, steerNow: Boolean): Outgoing =
    unsent?.takeIf { it.text == field } ?: Outgoing(field, steerNow)

/**
 * The resend after a reconnection: only the unsent message, and only while the field still holds exactly its text. An
 * edit is something the person hasn't sent, so it waits for a tap on Send.
 */
fun resendOf(unsent: Outgoing?, field: String): Outgoing? = unsent?.takeIf { it.text == field && it.text.isNotBlank() }

/** Why nothing left the phone when the person didn't prove it's them. */
fun presenceMessage(reason: Presence): Int = when (reason) {
    Presence.CONFIRMED -> throw IllegalArgumentException("confirmed presence blocks nothing")
    Presence.NOT_CONFIRMED -> R.string.presence_not_confirmed
    Presence.NO_SCREEN_LOCK -> R.string.presence_no_screen_lock
}

/** What to tell the person after a command, or null when it went through. */
fun commandMessage(result: CommandResult): Int? = when (result) {
    is CommandResult.Done -> null
    CommandResult.Offline -> R.string.action_offline
    CommandResult.NoAnswer -> R.string.action_no_answer
    is CommandResult.Refused -> when (result.code) {
        RemoteErrorCode.RATE_LIMITED -> R.string.action_rate_limited
        RemoteErrorCode.PANE_NOT_SHARED, RemoteErrorCode.FORBIDDEN -> R.string.terminal_input_not_shared
        else -> R.string.action_refused
    }
}

/** The same for an answer to a request, whose refusals have their own words. */
fun answerMessage(result: CommandResult): Int = when (result) {
    is CommandResult.Done -> R.string.request_answered
    CommandResult.Offline -> R.string.action_offline
    CommandResult.NoAnswer -> R.string.action_no_answer
    is CommandResult.Refused -> when (result.code) {
        RemoteErrorCode.NOT_PENDING -> R.string.request_refused_not_pending
        RemoteErrorCode.STALE_GENERATION -> R.string.request_refused_stale_generation
        RemoteErrorCode.FORBIDDEN -> R.string.request_refused_forbidden
        RemoteErrorCode.RATE_LIMITED -> R.string.request_refused_rate_limited
        else -> R.string.request_refused_other
    }
}

// ---- 1.5.0 F10 API skeleton (A47), no behaviour; MOB-A47 replaces the TODOs. Test: ComposerModeTest. ----

enum class ComposerControl { STOP, STEER, SEND }

/** The composer's controls, and whether Send shows "Queued until the current step ends". */
data class ComposerMode(val controls: List<ComposerControl>, val queuedPlaceholder: Boolean)

@Suppress("UNUSED_PARAMETER")
fun composerMode(running: Boolean, canSteer: Boolean): ComposerMode = TODO("F10 A47")

/** What to tell the person after a steer; a `forbidden` refusal is "the agent finished before". */
@Suppress("UNUSED_PARAMETER")
fun steerMessage(result: CommandResult): Int? = TODO("F10 A47")

/** The message to resend after a reconnection, or null: only one whose fate is unknown. */
@Suppress("UNUSED_PARAMETER")
fun unsentAfter(result: CommandResult, outgoing: Outgoing): Outgoing? = TODO("F10 A47")

/** The field keeps its text unless the message went through. */
@Suppress("UNUSED_PARAMETER")
fun keepsText(result: CommandResult): Boolean = TODO("F10 A47")
