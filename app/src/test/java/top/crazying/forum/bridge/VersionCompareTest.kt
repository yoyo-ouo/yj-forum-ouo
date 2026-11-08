package top.crazying.forum.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionCompareTest {
    @Test
    fun newerVersionWins() {
        assertTrue(VersionCompare.compare("2.0.0", "1.3.0") > 0)
        assertTrue(VersionCompare.compare("2.0.1", "2.0.0") > 0)
        assertEquals(0, VersionCompare.compare("2.0.0", "2.0"))
        assertTrue(VersionCompare.compare("1.9.9", "2.0.0") < 0)
    }
}
