// This suite runs without React Native; invite.ts only needs these three.
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Linking: { openURL: jest.fn() }, Platform: { OS: 'ios' } }));

import { inviteMessage, smsUrl, whatsAppUrl } from '../invite';

const t = ((key: string, params?: Record<string, string>) =>
  params ? `${key}:${JSON.stringify(params)}` : key) as any;

describe('invite links', () => {
  it('opens WhatsApp straight into a chat with the person, message written', () => {
    expect(whatsAppUrl('+252634123456', 'Join me & get $1')).toBe(
      'https://wa.me/252634123456?text=Join%20me%20%26%20get%20%241'
    );
  });

  it('writes the text message the way each phone expects', () => {
    expect(smsUrl('+252634123456', 'Hi there', 'ios')).toBe('sms:+252634123456&body=Hi%20there');
    expect(smsUrl('+252634123456', 'Hi there', 'android')).toBe('sms:+252634123456?body=Hi%20there');
  });

  it('puts the referral code in the message, and leaves it out when there is none', () => {
    expect(inviteMessage(t, ' ZAPP42 ')).toBe('invite.message:{"code":"ZAPP42"}');
    expect(inviteMessage(t, '')).toBe('invite.messageNoCode');
    expect(inviteMessage(t, undefined)).toBe('invite.messageNoCode');
  });
});
