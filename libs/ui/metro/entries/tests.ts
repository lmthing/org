/**
 * The bundle entry for the EXECUTED half of the harness. Importing a suite registers its cases
 * (see `../harness.ts`); this file then runs them and reports on stdout, where `../run.mjs` reads
 * the results back.
 *
 * Suites are listed explicitly rather than globbed: Metro resolves a static graph, and a glob would
 * have to become a build step to work at all.
 */
import '../suites/theme'
import '../suites/primitives'
import '../suites/overlays'
import '../suites/platform'
import '../suites/markdown'
import '../suites/nav'
import '../suites/chat-shell'
import '../suites/dashboard'
import '../suites/descriptor'
import '../suites/auth'
import '../suites/auth-login'
import '../suites/team'
import '../suites/view'
import '../suites/native-style-units'
import '../suites/string-children'
import '../suites/branding'
import '../suites/text-styling'
import { runRegisteredCases } from '../harness'

void runRegisteredCases()
