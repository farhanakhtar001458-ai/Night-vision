import { z } from 'zod';

export const CLIENT_EVENTS = [
  'ping',
  'device:heartbeat',
  'device:status',
  'connection:request',
  'connection:accepted',
  'connection:rejected',
  'rtc:offer',
  'rtc:answer',
  'rtc:ice',
  'rtc:hangup',
  'transfer:progress',
  'transfer:completed',
  'transfer:failed',
  'file:list',
  'file:response',
  'clipboard:sync',
  'notification:sync',
  'command:result',
] as const;

export type ClientEventType = (typeof CLIENT_EVENTS)[number];

const base = z.object({ type: z.enum(CLIENT_EVENTS) });

export const clientEventSchema = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('ping'), t: z.number().optional() }),
  base.extend({
    type: z.literal('device:heartbeat'),
    battery: z.number().min(0).max(100).optional(),
    charging: z.boolean().optional(),
    network: z.string().max(32).optional(),
  }),
  base.extend({
    type: z.literal('device:status'),
    telemetry: z.record(z.unknown()).optional(),
    battery: z.number().min(0).max(100).optional(),
    charging: z.boolean().optional(),
    network: z.string().max(32).optional(),
  }),
  base.extend({
    type: z.literal('connection:request'),
    targetDeviceId: z.string().uuid().optional(),
    connectionId: z.string().uuid().optional(),
    connectionType: z.enum(['mirror', 'camera', 'file', 'control', 'clipboard']),
  }),
  base.extend({ type: z.literal('connection:accepted'), connectionId: z.string().uuid() }),
  base.extend({ type: z.literal('connection:rejected'), connectionId: z.string().uuid(), reason: z.string().max(256).optional() }),
  base.extend({
    type: z.literal('rtc:offer'),
    connectionId: z.string().uuid(),
    sdp: z.string().min(1),
    kind: z.enum(['mirror', 'camera', 'control']).optional(),
  }),
  base.extend({ type: z.literal('rtc:answer'), connectionId: z.string().uuid(), sdp: z.string().min(1) }),
  base.extend({
    type: z.literal('rtc:ice'),
    connectionId: z.string().uuid(),
    candidate: z.string().min(1),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
  }),
  base.extend({ type: z.literal('rtc:hangup'), connectionId: z.string().uuid(), reason: z.string().max(256).optional() }),
  base.extend({ type: z.literal('transfer:progress'), transferId: z.string().uuid(), bytes: z.number().min(0), total: z.number().min(0).optional() }),
  base.extend({ type: z.literal('transfer:completed'), transferId: z.string().uuid(), itemIndex: z.number().int().min(0).optional() }),
  base.extend({ type: z.literal('transfer:failed'), transferId: z.string().uuid(), error: z.string().max(512) }),
  base.extend({
    type: z.literal('file:list'),
    requestId: z.string().max(64),
    path: z.string().max(512).optional(),
    category: z.string().max(32).optional(),
  }),
  base.extend({ type: z.literal('file:response'), requestId: z.string().max(64), payload: z.record(z.unknown()) }),
  base.extend({
    type: z.literal('clipboard:sync'),
    content: z.string().max(64 * 1024),
    contentType: z.string().max(64).optional(),
    sensitive: z.boolean().optional(),
  }),
  base.extend({ type: z.literal('notification:sync'), payload: z.record(z.unknown()) }),
  base.extend({ type: z.literal('command:result'), requestId: z.string().max(64), payload: z.record(z.unknown()) }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

export type ServerEventType =
  | 'hello'
  | 'error'
  | 'pong'
  | 'device:online'
  | 'device:offline'
  | 'device:heartbeat'
  | 'device:status'
  | 'presence:sync'
  | 'connection:request'
  | 'connection:accepted'
  | 'connection:rejected'
  | 'connection:ended'
  | 'rtc:offer'
  | 'rtc:answer'
  | 'rtc:ice'
  | 'rtc:hangup'
  | 'transfer:progress'
  | 'transfer:completed'
  | 'transfer:failed'
  | 'file:list'
  | 'file:response'
  | 'clipboard:sync'
  | 'notification:sync'
  | 'command:result';
