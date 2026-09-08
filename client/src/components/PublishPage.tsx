import { useState } from 'react';
import { PLATFORMS } from '../lib/api';
import { formatScheduleDisplay } from '../lib/format';
import type { UploadApi } from '../hooks/useUpload';
import type { ClipMeta, Platform } from '../types';

interface PublishPageProps {
  upload: UploadApi;
  clips: ClipMeta[];
  onGoClips: () => void;
}

/** Panduan upload manual per platform — tanpa unduh ulang (file sudah tersimpan otomatis saat render). */
function OtherPlatformsCard({ clip, caption }: { clip: ClipMeta; caption: string }) {
  const [opened, setOpened] = useState<Platform | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoMsg, setAutoMsg] = useState('');

  const openPlatform = async (key: Platform, url: string) => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
    } catch { setCopied(false); }
    setOpened(key);
    setAutoMsg('');
    window.open(url, '_blank');
  };

  // TikTok: simpan payload lalu buka Creator Center — content script
  // mengisi video + caption otomatis, pengguna menekan Post sendiri.
  const automateTikTok = async (url: string) => {
    const payload = {
      clipId: clip.id,
      videoUrl: `http://localhost:3002/api/clips/${clip.id}`,
      filename: clip.filename,
      caption,
      timestamp: Date.now(),
    };
    try {
      const g = globalThis as any;
      if (g.chrome?.storage?.local) {
        await g.chrome.storage.local.set({ yt_clipper_tiktok_payload: payload });
      } else {
        localStorage.setItem('yt_clipper_tiktok_payload', JSON.stringify(payload));
      }
      setAutoMsg('Payload tersimpan. Tab TikTok dibuka — tunggu video dan caption terisi otomatis, lalu tekan Post.');
      setOpened(null);
      window.open(url, '_blank');
    } catch {
      setAutoMsg('Gagal menyimpan payload. Pakai tombol Buka (manual) sebagai gantinya.');
    }
  };

  return (
    <div className="card animate-in">
      <div className="section-header">
        <h3>Platform Lain (TikTok, Instagram, Facebook)</h3>
        <p className="section-desc">Satu klik per platform — file tidak diunduh ulang.</p>
      </div>
      <div className="platform-toggles">
        {PLATFORMS.filter(p => p.key !== 'youtube').map(p => (
          <div key={p.key} className="platform-toggle-item">
            <div className="platform-toggle-info">
              <div>
                <span className="platform-toggle-name">{p.name}</span>
                <span className="platform-toggle-desc">{p.desc}</span>
              </div>
            </div>
            <button type="button" className="ghost-btn" onClick={() => openPlatform(p.key, p.url)}>
              Buka
            </button>
            {p.key === 'tiktok' && (
              <button type="button" className="ghost-btn" onClick={() => automateTikTok(p.url)} title="Isi video dan caption otomatis (tekan Post manual)">
                Otomatisasi
              </button>
            )}
          </div>
        ))}
      </div>
      {autoMsg && (
        <div className="upload-step-guide animate-in" style={{ marginTop: '10px' }}>
          <p className="guide-text">{autoMsg}</p>
        </div>
      )}
      {opened && (
        <div className="upload-step-guide animate-in" style={{ marginTop: '10px' }}>
          <div className="guide-header"><strong>Langkah upload manual:</strong></div>
          <p className="guide-text">
            1. File <strong>{clip.filename}</strong> sudah tersimpan otomatis di folder Unduhan (tidak perlu unduh lagi).<br />
            2. Seret file tersebut ke area upload di tab yang baru dibuka.<br />
            3. Tempel caption {copied ? '(sudah disalin otomatis)' : 'di bawah ini'} ke kolom caption, lalu terbitkan.
          </p>
          {!copied && (
            <button
              type="button"
              className="ghost-btn"
              style={{ marginTop: '8px' }}
              onClick={() => navigator.clipboard.writeText(caption).then(() => setCopied(true)).catch(() => {})}
            >
              Salin Caption {copied ? '(tersalin)' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PublishPage({ upload: u, clips, onGoClips }: PublishPageProps) {
  return (
    <div className="upload-panel animate-in">
      <div className="upload-subtabs">
        <button
          type="button"
          className={`subtab-btn ${u.uploadSubMode === 'single' ? 'active' : ''}`}
          onClick={() => u.setUploadSubMode('single')}
        >
          Satu Video
        </button>
        <button
          type="button"
          className={`subtab-btn ${u.uploadSubMode === 'batch' ? 'active' : ''}`}
          onClick={() => {
            u.setUploadSubMode('batch');
            if (u.selectedBatchClipIds.length === 0 && clips.length > 0) {
              u.toggleSelectAllBatch();
            }
          }}
        >
          Batch Terjadwal ({clips.length})
        </button>
      </div>

      {u.uploadSubMode === 'single' && (
        <>
          <div className="card">
            <div className="input-group">
              <label>Pilih Klip</label>
              <div className="custom-select-wrapper">
                <select
                  className="custom-select"
                  value={u.selectedClipId}
                  onChange={e => u.setSelectedClipId(e.target.value)}
                >
                  <option value="">-- Pilih klip --</option>
                  {clips.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.durationFormatted})
                    </option>
                  ))}
                </select>
                <span className="select-arrow">▾</span>
              </div>
            </div>
          </div>

          {u.selectedClip && (
            <div className="card yt-upload-card animate-in">
              <div className="section-header yt-card-header">
                <div className="yt-badge-title">
                  <div>
                    <h3>Upload ke YouTube Studio</h3>
                    <p className="section-desc">
                      Memakai sesi login browser. Video dan form diisi otomatis di YouTube Studio.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ai-caption-btn"
                  onClick={u.handleGenerateAICaption}
                  disabled={u.generatingCaption}
                >
                  {u.generatingCaption ? 'Membuat Caption AI...' : 'Buat Caption AI'}
                </button>
              </div>

              {u.uploadStatusMsg && (
                <div className="upload-status-alert alert-ok">{u.uploadStatusMsg}</div>
              )}

              <div className="caption-form">
                <div className="input-group">
                  <div className="label-row">
                    <label>Nama Channel / Kreator</label>
                  </div>
                  <div className="input-wrapper">
                    <input
                      type="text"
                      value={u.channelName}
                      onChange={e => {
                        u.setChannelName(e.target.value);
                        localStorage.setItem('yt_clipper_channel', e.target.value);
                      }}
                      placeholder="Nama channel..."
                    />
                  </div>
                </div>

                <div className="input-group">
                  <div className="label-row">
                    <label>Judul</label>
                    <span className="char-counter">{u.uploadTitle.length}/100</span>
                  </div>
                  <input
                    type="text"
                    className="caption-input"
                    value={u.uploadTitle}
                    onChange={e => u.setUploadTitle(e.target.value)}
                    placeholder="Judul video..."
                    maxLength={100}
                  />
                </div>

                <div className="input-group">
                  <label>Deskripsi</label>
                  <textarea
                    className="caption-textarea"
                    rows={3}
                    value={u.uploadDesc}
                    onChange={e => u.setUploadDesc(e.target.value)}
                    placeholder="Deskripsi isi video..."
                  />
                </div>

                <div className="input-group">
                  <label>Tagar</label>
                  <input
                    type="text"
                    className="caption-input"
                    value={u.uploadTags}
                    onChange={e => u.setUploadTags(e.target.value)}
                    placeholder="#Shorts #Viral"
                  />
                </div>

                <div className="schedule-box">
                  <div className="schedule-header">
                    <div className="schedule-info">
                      <div>
                        <span className="schedule-title">Jadwalkan Publikasi</span>
                        <span className="schedule-desc">Atur tanggal dan jam tayang otomatis</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`toggle-switch ${u.isScheduleActive ? 'on' : ''}`}
                      onClick={() => u.setIsScheduleActive(!u.isScheduleActive)}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>

                  {u.isScheduleActive && (
                    <div className="schedule-picker-row animate-in">
                      <label>Waktu Publikasi:</label>
                      <input
                        type="datetime-local"
                        className="schedule-datetime-input"
                        value={u.scheduleTime}
                        onChange={e => u.setScheduleTime(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div className="publish-mode-selector animate-in">
                  <label className="mode-label">Mode Otomatisasi:</label>
                  <div className="publish-mode-options">
                    <div
                      className={`publish-mode-card ${u.autoPublishMode ? 'selected' : ''}`}
                      onClick={() => u.setAutoPublishMode(true)}
                    >
                      <div className="mode-card-header">
                        <span className="mode-title">Penuh Otomatis</span>
                        <span className="mode-badge-rec">Disarankan</span>
                      </div>
                      <p className="mode-desc">
                        Upload, isi judul dan deskripsi, klik Berikutnya sampai terbit. Tanpa campur tangan.
                      </p>
                    </div>

                    <div
                      className={`publish-mode-card ${!u.autoPublishMode ? 'selected' : ''}`}
                      onClick={() => u.setAutoPublishMode(false)}
                    >
                      <div className="mode-card-header">
                        <span className="mode-title">Periksa Dulu</span>
                      </div>
                      <p className="mode-desc">
                        Isi form otomatis, berhenti di langkah akhir agar bisa diperiksa sebelum terbit.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="upload-step-guide animate-in">
                  <div className="guide-header">
                    <strong>Cara kerja otomatisasi:</strong>
                  </div>
                  <p className="guide-text">
                    1. Klik tombol di bawah, tab YouTube Studio terbuka.<br />
                    2. Ekstensi menyuntikkan file video tanpa drag manual.<br />
                    3. Ekstensi mengisi judul, deskripsi, tagar, lalu menekan Berikutnya sampai selesai.
                  </p>
                </div>

                <div className="yt-action-buttons">
                  <button
                    type="button"
                    className="submit-btn yt-direct-upload-btn"
                    onClick={u.handleUploadToYouTubeShorts}
                  >
                    {u.autoPublishMode ? 'Upload dan Terbitkan Otomatis' : 'Upload dan Periksa di YouTube'}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn copy-all-btn"
                    onClick={u.handleCopyAllCaption}
                    title="Salin semua teks ke clipboard"
                  >
                    Salin Teks
                  </button>
                </div>
              </div>
            </div>
          )}

          {!u.selectedClip && (
            <div className="empty-state">
              <h3>{clips.length === 0 ? 'Belum ada klip' : 'Pilih klip di atas'}</h3>
              <p>{clips.length === 0 ? 'Buat klip dulu sebelum publikasi.' : 'Pilih klip dari daftar untuk melihat opsi publikasi.'}</p>
              {clips.length === 0 && <button className="ghost-btn" onClick={onGoClips}>Lihat Klip</button>}
            </div>
          )}

          {u.selectedClip && (
            <OtherPlatformsCard
              clip={u.selectedClip}
              caption={`${u.uploadTitle}\n\n${u.uploadDesc}\n\n${u.uploadTags}`.trim()}
            />
          )}
        </>
      )}

      {u.uploadSubMode === 'batch' && (
        <div className="batch-scheduler-card card animate-in">
          <div className="section-header yt-card-header">
            <div className="yt-badge-title">
              <div>
                <h3>Jadwal Batch</h3>
                <p className="section-desc">
                  Upload beberapa video sekaligus. Ekstensi menjadwalkan satu per satu sesuai interval.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="ai-caption-btn"
              onClick={u.handleGenerateBatchAICaptions}
              disabled={u.generatingBatchCaptions || u.selectedBatchClipIds.length === 0}
              title="Buat judul dan tag AI untuk semua video terpilih"
            >
              {u.generatingBatchCaptions ? 'Membuat Caption...' : `Caption AI Semua (${u.selectedBatchClipIds.length})`}
            </button>
          </div>

          {u.uploadStatusMsg && (
            <div className="upload-status-alert alert-ok">{u.uploadStatusMsg}</div>
          )}

          <div className="batch-config-grid">
            <div className="input-group">
              <label>Jadwal Pertama</label>
              <input
                type="datetime-local"
                className="schedule-datetime-input"
                value={u.batchStartTime}
                onChange={e => u.setBatchStartTime(e.target.value)}
              />
              <span className="input-hint">Waktu tayang video urutan pertama</span>
            </div>

            <div className="input-group">
              <label>Jeda Antar Video</label>
              <div className="interval-pills">
                {[1, 2, 3, 4, 6, 12, 24].map(hours => (
                  <button
                    key={hours}
                    type="button"
                    className={`interval-pill ${u.batchIntervalHours === hours ? 'active' : ''}`}
                    onClick={() => u.setBatchIntervalHours(hours)}
                  >
                    {hours === 24 ? '1 Hari' : `${hours} Jam`}
                  </button>
                ))}
              </div>
              <span className="input-hint">Video berikutnya tayang tiap +{u.batchIntervalHours} jam</span>
            </div>

            <div className="input-group">
              <label>Batas Harian</label>
              <div className="interval-pills">
                {[2, 3, 4].map(quota => (
                  <button
                    key={quota}
                    type="button"
                    className={`interval-pill ${u.batchDailyQuota === quota ? 'active' : ''}`}
                    onClick={() => u.setBatchDailyQuota(quota)}
                  >
                    {quota}/hari
                  </button>
                ))}
                <button
                  type="button"
                  className={`interval-pill ${u.batchDailyQuota === 0 ? 'active' : ''}`}
                  onClick={() => u.setBatchDailyQuota(0)}
                >
                  Tanpa batas
                </button>
              </div>
              <span className="input-hint">
                {u.batchDailyQuota > 0
                  ? `Maks ${u.batchDailyQuota} video/hari — antrean ${u.selectedBatchClipIds.length} video selesai dalam ${Math.max(1, Math.ceil(u.selectedBatchClipIds.length / u.batchDailyQuota))} hari`
                  : 'Semua video dijadwalkan berurutan sesuai interval'}
              </span>
            </div>
          </div>

          <div className="input-group">
            <div className="label-row">
              <label>Nama Channel / Kreator</label>
            </div>
            <div className="input-wrapper">
              <input
                type="text"
                value={u.channelName}
                onChange={e => {
                  u.setChannelName(e.target.value);
                  localStorage.setItem('yt_clipper_channel', e.target.value);
                }}
                placeholder="Nama channel..."
              />
            </div>
          </div>

          <div className="batch-select-all-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={clips.length > 0 && u.selectedBatchClipIds.length === clips.length}
                onChange={u.toggleSelectAllBatch}
              />
              <span>Pilih Semua ({u.selectedBatchClipIds.length}/{clips.length})</span>
            </label>
          </div>

          {clips.length === 0 ? (
            <div className="empty-state">
              <p>Belum ada klip di Klip Saya.</p>
              <button className="ghost-btn" onClick={onGoClips}>Lihat Klip</button>
            </div>
          ) : (
            <div className="batch-queue-list">
              {clips.map((clip) => {
                const isSelected = u.selectedBatchClipIds.includes(clip.id);
                const queueIndex = u.selectedBatchClipIds.indexOf(clip.id);
                const schedTime = isSelected ? u.getClipScheduledTime(clip.id, queueIndex) : '';
                const customCap = u.batchCaptions[clip.id];

                return (
                  <div key={clip.id} className={`batch-queue-item ${isSelected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => u.toggleSelectBatchClip(clip.id)}
                      style={{ marginTop: '5px', cursor: 'pointer' }}
                    />

                    {isSelected && <div className="queue-index-badge">#{queueIndex + 1}</div>}

                    <div className="queue-item-content">
                      <div className="queue-item-header">
                        <input
                          type="text"
                          className="queue-item-title-input"
                          value={customCap?.title || clip.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            u.setBatchCaptions(prev => ({
                              ...prev,
                              [clip.id]: {
                                ...(prev[clip.id] || {
                                  description: clip.transcript || 'Video seru!',
                                  hashtags: ['#Shorts', '#Viral'],
                                }),
                                title: val,
                              }
                            }));
                          }}
                          placeholder="Judul video..."
                        />
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {clip.durationFormatted}
                        </span>
                      </div>

                      {isSelected && (
                        <div className="queue-item-schedule-row">
                          <span className="schedule-pill-badge">
                            Jadwal: {formatScheduleDisplay(schedTime)}
                          </span>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            Ubah jam:
                            <input
                              type="datetime-local"
                              className="edit-schedule-inline"
                              value={schedTime}
                              onChange={(e) => {
                                const val = e.target.value;
                                u.setCustomClipSchedules(prev => ({ ...prev, [clip.id]: val }));
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="upload-step-guide animate-in">
            <div className="guide-header">
              <strong>Cara kerja penjadwalan batch:</strong>
            </div>
            <p className="guide-text">
              Ekstensi membuka video pertama, mengupload, mengisi judul/deskripsi/tag, menyetel jadwal,
              lalu otomatis lanjut ke video berikutnya sampai antrean habis.
            </p>
          </div>

          <button
            type="button"
            className="submit-btn batch-all-btn"
            onClick={u.handleStartBatchUpload}
            disabled={u.selectedBatchClipIds.length === 0 || u.batchUploading}
          >
            {u.batchUploading ? 'Mengirim antrean...' : `Jadwalkan dan Upload ${u.selectedBatchClipIds.length} Video`}
          </button>
        </div>
      )}
    </div>
  );
}
