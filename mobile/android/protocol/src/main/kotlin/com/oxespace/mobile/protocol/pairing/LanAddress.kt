package com.oxespace.mobile.protocol.pairing

/**
 * The gateway only ever lives on the local network, so the app talks only to private addresses: IPv4 RFC 1918 and
 * link-local, IPv6 link-local (fe80::/10) and unique local (fc00::/7). Only address literals count; a name would need
 * DNS, which could point anywhere.
 */
object LanAddress {
    private val ipv4 = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""")

    fun isPrivate(host: String): Boolean {
        val bare = host.removePrefix("[").removeSuffix("]").substringBefore('%')
        ipv4.matchEntire(bare)?.let { match ->
            val octets = match.groupValues.drop(1).map { it.toInt() }
            if (octets.any { it > 255 }) return false
            val (a, b) = octets
            return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
        }
        val words = ipv6Words(bare) ?: return false
        val first = words[0]
        return (first and 0xffc0) == 0xfe80 || (first and 0xfe00) == 0xfc00
    }

    /** The eight 16-bit words of an IPv6 literal, or null when it isn't one. Embedded IPv4 forms are not LAN gateways. */
    private fun ipv6Words(text: String): IntArray? {
        if (!text.contains(':') || text.count { it == ':' } > 7 || text.contains(":::")) return null
        val halves = text.split("::")
        if (halves.size > 2) return null
        fun parse(part: String): List<Int>? =
            if (part.isEmpty()) emptyList()
            else part.split(':').map { word -> if (word.length in 1..4 && word.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) word.toInt(16) else return null }
        val head = parse(halves[0]) ?: return null
        val tail = if (halves.size == 2) parse(halves[1]) ?: return null else emptyList()
        val missing = 8 - head.size - tail.size
        if ((halves.size == 1 && missing != 0) || (halves.size == 2 && missing < 1)) return null
        return (head + List(missing) { 0 } + tail).toIntArray()
    }
}
