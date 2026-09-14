package com.hejhome.ainote

import java.net.URI

class AndroidAppExperience(
    private val trustedUrls: TrustedUrlPolicy,
) {
    fun shouldSimplifyCustomerAccess(url: String): Boolean {
        if (!trustedUrls.isInternal(url)) return false
        return normalizedPath(url) in setOf("/login", "/forgot-password", "/password/change")
    }

    fun shouldBlockNavigation(url: String): Boolean {
        if (!trustedUrls.isInternal(url)) return false
        val path = normalizedPath(url)
        return path == "/admin" || path.startsWith("/admin/")
    }

    private fun normalizedPath(url: String): String {
        val path = runCatching { URI(url).path }.getOrNull().orEmpty()
        return path.trimEnd('/').ifEmpty { "/" }
    }

    companion object {
        const val SIMPLIFY_CUSTOMER_ACCESS_SCRIPT = """
            (function () {
              try {
                var path = location.pathname.replace(/\/+$/, '');
                if (!['/login', '/forgot-password', '/password/change'].includes(path)) return false;
                var main = document.querySelector('main');
                if (!main) return false;

                document.documentElement.setAttribute('data-ai-note-android-customer-access', 'compact');
                var sections = Array.prototype.filter.call(main.children, function (element) {
                  return element.tagName === 'SECTION';
                });
                if (sections.length > 1) {
                  sections[0].style.setProperty('display', 'none', 'important');
                  main.style.setProperty('display', 'block', 'important');
                  var loginSection = sections[sections.length - 1];
                  loginSection.style.setProperty('min-height', '100vh', 'important');
                  loginSection.style.setProperty('padding', '24px 20px', 'important');
                }

                var form = main.querySelector('form');
                if (form && form.parentElement) {
                  var card = form.parentElement;
                  var heading = card.querySelector(':scope > h2');
                  var children = Array.prototype.slice.call(card.children);
                  var formIndex = children.indexOf(form);
                  children.forEach(function (element, index) {
                    var role = element.getAttribute('role');
                    var isNotice = role === 'alert' || role === 'status';
                    var keep = element === form || element === heading || isNotice;
                    if (!keep || index > formIndex) {
                      element.style.setProperty('display', 'none', 'important');
                    }
                  });
                  if (heading) heading.style.setProperty('margin-top', '0', 'important');
                  form.style.setProperty('margin-top', '24px', 'important');
                }

                document.querySelectorAll('a[href="/admin"], a[href^="/admin/"]').forEach(function (link) {
                  link.style.setProperty('display', 'none', 'important');
                });
                return true;
              } catch (_) {
                return false;
              }
            })()
        """
    }
}
