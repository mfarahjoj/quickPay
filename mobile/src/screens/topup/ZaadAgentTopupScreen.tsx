/**
 * The old route for remote Zaad top-ups (customer build 82). Zaad is now part
 * of "Top up with an agent" (AgentTopupScreen); this opens that flow on
 * "Find me an agent", so navigation calls and links to it keep working.
 */

import React from 'react';
import AgentTopupScreen from './AgentTopupScreen';

export default function ZaadAgentTopupScreen() {
  return <AgentTopupScreen initialWay="remote" />;
}
