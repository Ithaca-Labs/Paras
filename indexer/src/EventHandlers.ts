import { indexer } from 'envio';
import { toActivity } from './mapping.js';

const on = indexer.onEvent;

on({ contract: 'Vault', event: 'Deposited' }, async ({ event, context }) => {
  context.VaultActivity.set(toActivity('deposit', event.params, event));
});
on({ contract: 'Vault', event: 'Withdrawn' }, async ({ event, context }) => {
  context.VaultActivity.set(toActivity('withdrawal', event.params, event));
});
on({ contract: 'Vault', event: 'DepositWalletRegistered' }, async ({ event, context }) => {
  context.VaultActivity.set(toActivity('wallet_registered', event.params, event));
});
on({ contract: 'Vault', event: 'IntentSubmitted' }, async ({ event, context }) => {
  context.VaultActivity.set(
    toActivity('intent_submitted', { ...event.params, intentId: event.params.id }, event),
  );
});
on({ contract: 'Vault', event: 'IntentCancelled' }, async ({ event, context }) => {
  context.VaultActivity.set(
    toActivity('intent_cancelled', { ...event.params, intentId: event.params.id }, event),
  );
});
on({ contract: 'Vault', event: 'IntentExpired' }, async ({ event, context }) => {
  context.VaultActivity.set(
    toActivity('intent_expired', { ...event.params, intentId: event.params.id }, event),
  );
});
on({ contract: 'Vault', event: 'IntentDispatched' }, async ({ event, context }) => {
  context.VaultActivity.set(
    toActivity('intent_dispatched', { ...event.params, intentId: event.params.id }, event),
  );
});
on({ contract: 'Vault', event: 'Settled' }, async ({ event, context }) => {
  context.VaultActivity.set(toActivity('settled', event.params, event));
});
on({ contract: 'Vault', event: 'IntentClosed' }, async ({ event, context }) => {
  context.VaultActivity.set(
    toActivity(
      'intent_closed',
      { user: event.params.user, intentId: event.params.id, amount: event.params.writtenOff },
      event,
    ),
  );
});
