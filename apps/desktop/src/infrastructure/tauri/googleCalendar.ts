import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './runtime';

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  description: string | null;
  primary: boolean;
  accessRole: string | null;
};

export type GoogleCalendarViewState = {
  clientConfigured: boolean;
  connected: boolean;
  reauthorizationRequired: boolean;
  selectedCalendarIds: string[];
  calendars: GoogleCalendarSummary[];
};

export type GoogleCalendarImportOutput = {
  importedEventCount: number;
  skippedEventCount: number;
  planCount: number;
  startYmd: string;
  endYmd: string;
};

const DISCONNECTED_STATE: GoogleCalendarViewState = {
  clientConfigured: false,
  connected: false,
  reauthorizationRequired: false,
  selectedCalendarIds: [],
  calendars: [],
};

function requireDesktop(): void {
  if (!isTauri()) {
    throw new Error('Google Calendar integration is available in the desktop app.');
  }
}

export async function getGoogleCalendarState(): Promise<GoogleCalendarViewState> {
  if (!isTauri()) return DISCONNECTED_STATE;
  return invoke<GoogleCalendarViewState>('google_calendar_get_state');
}

export async function connectGoogleCalendar(): Promise<GoogleCalendarViewState> {
  requireDesktop();
  return invoke<GoogleCalendarViewState>('google_calendar_begin_auth');
}

export async function refreshGoogleCalendars(): Promise<GoogleCalendarViewState> {
  requireDesktop();
  return invoke<GoogleCalendarViewState>('google_calendar_refresh_calendars');
}

export async function importGoogleCalendarEvents(
  startYmd: string,
  endYmd: string,
): Promise<GoogleCalendarImportOutput> {
  requireDesktop();
  return invoke<GoogleCalendarImportOutput>('google_calendar_import', {
    request: { startYmd, endYmd },
  });
}

export async function saveGoogleCalendarSelection(
  selectedCalendarIds: string[],
): Promise<GoogleCalendarViewState> {
  requireDesktop();
  return invoke<GoogleCalendarViewState>('google_calendar_set_selection', {
    request: { selectedCalendarIds },
  });
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarViewState> {
  requireDesktop();
  return invoke<GoogleCalendarViewState>('google_calendar_disconnect');
}
