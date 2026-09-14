package com.hejhome.ainote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidAppExperienceTest {
    private val experience = AndroidAppExperience(
        TrustedUrlPolicy("https://lecture-interpreted-considerable-experience.trycloudflare.com"),
    )

    @Test
    fun `simplifies customer password access pages on the trusted origin`() {
        assertTrue(experience.shouldSimplifyCustomerAccess("https://lecture-interpreted-considerable-experience.trycloudflare.com/login"))
        assertTrue(experience.shouldSimplifyCustomerAccess("https://lecture-interpreted-considerable-experience.trycloudflare.com/login?next=%2F"))
        assertTrue(experience.shouldSimplifyCustomerAccess("https://lecture-interpreted-considerable-experience.trycloudflare.com/forgot-password"))
        assertTrue(experience.shouldSimplifyCustomerAccess("https://lecture-interpreted-considerable-experience.trycloudflare.com/password/change"))

        assertFalse(experience.shouldSimplifyCustomerAccess("https://lecture-interpreted-considerable-experience.trycloudflare.com/signup"))
        assertFalse(experience.shouldSimplifyCustomerAccess("https://lecture-interpreted-considerable-experience.trycloudflare.com/admin/login"))
        assertFalse(experience.shouldSimplifyCustomerAccess("https://example.com/login"))
    }

    @Test
    fun `blocks operator pages inside the Android app`() {
        assertTrue(experience.shouldBlockNavigation("https://lecture-interpreted-considerable-experience.trycloudflare.com/admin"))
        assertTrue(experience.shouldBlockNavigation("https://lecture-interpreted-considerable-experience.trycloudflare.com/admin/login?next=%2Fadmin"))

        assertFalse(experience.shouldBlockNavigation("https://lecture-interpreted-considerable-experience.trycloudflare.com/login"))
        assertFalse(experience.shouldBlockNavigation("https://lecture-interpreted-considerable-experience.trycloudflare.com/meetings/admin-review"))
        assertFalse(experience.shouldBlockNavigation("https://example.com/admin"))
    }
}
