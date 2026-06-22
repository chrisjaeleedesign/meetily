import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';

export interface ExcludedSystemAudioApp {
  root_bundle_id: string;
  display_name: string;
}

export interface SystemAudioSourceApp {
  display_name: string;
  root_bundle_id: string | null;
  process_bundle_id: string | null;
  pid: number;
  process_object_id: number;
  is_running_output: boolean;
  can_exclude: boolean;
}

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  system_audio_backend?: string | null;
  excluded_system_audio_apps: ExcludedSystemAudioApp[];
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

const normalizePreferences = (prefs: RecordingPreferences): RecordingPreferences => ({
  ...prefs,
  excluded_system_audio_apps: prefs.excluded_system_audio_apps ?? []
});

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null,
    system_audio_backend: null,
    excluded_system_audio_apps: []
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);
  const [systemAudioSources, setSystemAudioSources] = useState<SystemAudioSourceApp[]>([]);
  const [loadingSystemAudioSources, setLoadingSystemAudioSources] = useState(false);

  const loadSystemAudioSources = React.useCallback(async () => {
    setLoadingSystemAudioSources(true);
    try {
      const sources = await invoke<SystemAudioSourceApp[]>('list_system_audio_source_apps_command');
      const dedupedSources = new Map<string, SystemAudioSourceApp>();

      sources.forEach(source => {
        const key = source.root_bundle_id
          ?? source.process_bundle_id
          ?? `${source.display_name}:${source.pid}:${source.process_object_id}`;

        if (!dedupedSources.has(key)) {
          dedupedSources.set(key, source);
        }
      });

      setSystemAudioSources(Array.from(dedupedSources.values()));
    } catch (error) {
      console.error('Failed to load system audio sources:', error);
      toast.error('Failed to load system audio sources');
    } finally {
      setLoadingSystemAudioSources(false);
    }
  }, []);

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(normalizePreferences(prefs));
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  useEffect(() => {
    loadSystemAudioSources();
  }, [loadSystemAudioSources]);

  // Load recording notification preference
  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };
    loadNotificationPref();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track auto-save setting change
    await Analytics.track('auto_save_recording_toggled', {
      enabled: enabled.toString()
    });
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track default device preference changes
    // Note: Individual device selection analytics are tracked in DeviceSelection component
    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleSystemAudioExclusionToggle = async (
    source: Pick<SystemAudioSourceApp, 'root_bundle_id' | 'display_name'>,
    enabled: boolean
  ) => {
    if (!source.root_bundle_id) {
      toast.error('This app cannot be excluded');
      return;
    }

    const currentExcludedApps = preferences.excluded_system_audio_apps ?? [];
    const nextExcludedApps = enabled
      ? [
          ...currentExcludedApps.filter(app => app.root_bundle_id !== source.root_bundle_id),
          {
            root_bundle_id: source.root_bundle_id,
            display_name: source.display_name || source.root_bundle_id
          }
        ]
      : currentExcludedApps.filter(app => app.root_bundle_id !== source.root_bundle_id);

    const newPreferences = {
      ...preferences,
      excluded_system_audio_apps: nextExcludedApps
    };

    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    await Analytics.track('system_audio_app_exclusion_toggled', {
      enabled: enabled.toString(),
      app_bundle_id: source.root_bundle_id,
      app_display_name: source.display_name || source.root_bundle_id
    });
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success('Preference saved');
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error('Failed to save preference');
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      toast.success("Recording preferences saved");
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error("Failed to save recording preferences", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-gray-200 rounded mb-4"></div>
      </div>
    );
  }

  const excludedApps = preferences.excluded_system_audio_apps ?? [];
  const excludedBundleIds = new Set(excludedApps.map(app => app.root_bundle_id));
  const visibleSourceBundleIds = new Set(
    systemAudioSources
      .map(source => source.root_bundle_id)
      .filter((bundleId): bundleId is string => Boolean(bundleId))
  );
  const savedOnlyExcludedApps = excludedApps.filter(
    app => !visibleSourceBundleIds.has(app.root_bundle_id)
  );
  const hasSystemAudioRows = systemAudioSources.length > 0 || savedOnlyExcludedApps.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Recording Settings</h3>
        <p className="text-sm text-gray-600 mb-6">
          Configure how your audio recordings are saved during meetings.
        </p>
      </div>

      {/* Auto Save Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">Save Audio Recordings</div>
          <div className="text-sm text-gray-600">
            Automatically save audio files when recording stops
          </div>
        </div>
        <Switch
          checked={preferences.auto_save}
          onCheckedChange={handleAutoSaveToggle}
          disabled={saving}
        />
      </div>

      {/* Folder Location - Only shown when auto_save is enabled */}
      {preferences.auto_save && (
        <div className="space-y-4">
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Save Location</div>
            <div className="text-sm text-gray-600 mb-3 break-all">
              {preferences.save_folder || 'Default folder'}
            </div>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div>

          <div className="p-4 border rounded-lg bg-blue-50">
            <div className="text-sm text-blue-800">
              <strong>File Format:</strong> {preferences.file_format.toUpperCase()} files
            </div>
            <div className="text-xs text-blue-600 mt-1">
              Recordings are saved with timestamp: recording_YYYYMMDD_HHMMSS.{preferences.file_format}
            </div>
          </div>
        </div>
      )}

      {/* Info when auto_save is disabled */}
      {!preferences.auto_save && (
        <div className="p-4 border rounded-lg bg-yellow-50">
          <div className="text-sm text-yellow-800">
            Audio recording is disabled. Enable "Save Audio Recordings" to automatically save your meeting audio.
          </div>
        </div>
      )}

      {/* Recording Notification Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">Recording Start Notification</div>
          <div className="text-sm text-gray-600">
            Show reminder to inform participants when recording starts
          </div>
        </div>
        <Switch
          checked={showRecordingNotification}
          onCheckedChange={handleNotificationToggle}
        />
      </div>

      {/* Device Preferences */}
      <div className="space-y-4">
        <div className="border-t pt-6">
          <h4 className="text-base font-medium text-gray-900 mb-4">Default Audio Devices</h4>
          <p className="text-sm text-gray-600 mb-4">
            Set your preferred microphone and system audio devices for recording. These will be automatically selected when starting new recordings.
          </p>

          <div className="border rounded-lg p-4 bg-gray-50">
            <DeviceSelection
              selectedDevices={{
                micDevice: preferences.preferred_mic_device,
                systemDevice: preferences.preferred_system_device
              }}
              onDeviceChange={handleDeviceChange}
              disabled={saving}
            />
          </div>
        </div>
      </div>

      {/* System Audio App Exclusions */}
      <div className="space-y-4">
        <div className="border-t pt-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h4 className="text-base font-medium text-gray-900">System Audio App Exclusions</h4>
              <p className="text-sm text-gray-600 mt-1">
                Excluded apps keep playing locally but are left out of system audio capture.
              </p>
            </div>
            <button
              onClick={loadSystemAudioSources}
              disabled={loadingSystemAudioSources}
              className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingSystemAudioSources ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="border rounded-lg bg-gray-50 divide-y">
            {!hasSystemAudioRows && (
              <div className="p-4 text-sm text-gray-600">
                No active system audio sources detected.
              </div>
            )}

            {systemAudioSources.map(source => {
              const bundleId = source.root_bundle_id;
              const isExcluded = bundleId ? excludedBundleIds.has(bundleId) : false;

              return (
                <div
                  key={`${bundleId ?? source.process_bundle_id ?? source.display_name}:${source.pid}:${source.process_object_id}`}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {source.display_name}
                    </div>
                    <div className="text-xs text-gray-500 break-all">
                      {bundleId ?? source.process_bundle_id ?? 'No bundle identifier'}
                    </div>
                  </div>
                  <Switch
                    checked={isExcluded}
                    onCheckedChange={(enabled) => handleSystemAudioExclusionToggle(source, enabled)}
                    disabled={saving || !source.can_exclude || !bundleId}
                  />
                </div>
              );
            })}

            {savedOnlyExcludedApps.map(app => (
              <div
                key={app.root_bundle_id}
                className="flex items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {app.display_name}
                  </div>
                  <div className="text-xs text-gray-500 break-all">
                    {app.root_bundle_id}
                  </div>
                </div>
                <Switch
                  checked
                  onCheckedChange={(enabled) => handleSystemAudioExclusionToggle({
                    root_bundle_id: app.root_bundle_id,
                    display_name: app.display_name
                  }, enabled)}
                  disabled={saving}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
