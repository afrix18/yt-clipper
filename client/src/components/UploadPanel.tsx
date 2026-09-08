import { PLATFORMS } from '../lib/api';
import { formatScheduleDisplay } from '../lib/format';
import type { UploadApi } from '../hooks/useUpload';
import type { ClipMeta } from '../types';

interface UploadPanelProps {
  upload: UploadApi;
  clips: ClipMeta[];
  onGoCreate: () => void;
}

export function UploadPanel({ upload, clips, onGoCreate }: UploadPanelProps) {
  const u = upload;

  return (
    <div className="upload-panel animate-in">
      {/* Toggle: tampilkan/sembunyikan seluruh section auto-upload */}
      <div className="card">
        <div className="platform-toggle-item">
          <div className="platform-toggle-info">
            <span className="platform-toggle-icon">🚀</span>
            <div>
              <span className="platform-toggle-name">Auto-Upload ke YouTube Studio</span>
              <span className="platform-toggle-desc">Tampilkan panel upload tunggal & batch schedule</span>
            </div>
          </div>
          <button
            type="button"
            className={`toggle-switch ${u.showAutoUpload ? 'on' : ''}`}
            onClick={() => u.setShowAutoUpload(prev => !prev)}
            aria-label="Toggle auto-upload"
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      {u.showAutoUpload && (
      <>
      {/* Sub-tabs: Single vs Batch */}
      <div className="upload-subtabs">
        <button
          type="button"
          className={`subtab-btn ${u.uploadSubMode === 'single' ? 'active' : ''}`}
          onClick={() => u.setUploadSubMode('single')}
        >
          🎯 Upload Tunggal
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
          📅 Batch Schedule (Banyak Video Sekaligus)
          {clips.length > 0 && <span className="batch-counter-badge">{clips.length}</span>}
        </button>
      </div>

      {/* SINGLE MODE */}
      {u.uploadSubMode === 'single' && (
        <>
          {/* Clip selector */}
          <div className="card">
            <div className="input-group">
              <label>Pilih Clip</label>
              <div className="custom-select-wrapper">
                <select
                  className="custom-select"
                  value={u.selectedClipId}
                  onChange={e => u.setSelectedClipId(e.target.value)}
                >
                  <option value="">-- Pilih clip --</option>
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

          {/* Platform toggles & YouTube Studio Auto-Upload */}
          {u.selectedClip && (
            <>
              {/* YouTube Shorts Auto-Upload Card */}
              <div className="card yt-upload-card animate-in">
                <div className="section-header yt-card-header">
                  <div className="yt-badge-title">
                    <span className="yt-icon">🎬</span>
                    <div>
                      <h3>YouTube Shorts Auto-Uploader & Scheduler</h3>
                      <p className="section-desc">
                        Gunakan sesi login browser Anda. Video & form akan diisi otomatis di YouTube Studio.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ai-caption-btn"
                    onClick={u.handleGenerateAICaption}
                    disabled={u.generatingCaption}
                  >
                    {u.generatingCaption ? (
                      <>
                        <span className="spinner-sm" /> Membuat Caption AI...
                      </>
                    ) : (
                      <>
                        <span>✨</span> Buat Caption & Tag AI
                      </>
                    )}
                  </button>
                </div>

                {u.uploadStatusMsg && (
                  <div className={`upload-status-alert ${u.uploadStatusMsg.startsWith('❌') ? 'alert-err' : 'alert-ok'}`}>
                    {u.uploadStatusMsg}
                  </div>
                )}

                <div className="caption-form">
                  {/* Channel / Creator Name */}
                  <div className="input-group">
                    <div className="label-row">
                      <label>Nama Channel / Kreator</label>
                      <span className="input-hint">— otomatis disertakan di hashtag & deskripsi</span>
                    </div>
                    <div className="input-wrapper">
                      <span className="input-icon">📢</span>
                      <input
                        type="text"
                        value={u.channelName}
                        onChange={e => {
                          u.setChannelName(e.target.value);
                          localStorage.setItem('yt_clipper_channel', e.target.value);
                        }}
                        placeholder="Nama channel Anda / kreator (contoh: Windah Basudara)..."
                      />
                    </div>
                  </div>

                  {/* Title */}
                  <div className="input-group">
                    <div className="label-row">
                      <label>Judul YouTube Shorts</label>
                      <span className="char-counter">{u.uploadTitle.length}/100</span>
                    </div>
                    <input
                      type="text"
                      className="caption-input"
                      value={u.uploadTitle}
                      onChange={e => u.setUploadTitle(e.target.value)}
                      placeholder="Judul video dengan hook menarik..."
                      maxLength={100}
                    />
                  </div>

                  {/* Description */}
                  <div className="input-group">
                    <label>Deskripsi Video</label>
                    <textarea
                      className="caption-textarea"
                      rows={3}
                      value={u.uploadDesc}
                      onChange={e => u.setUploadDesc(e.target.value)}
                      placeholder="Deskripsi kontekstual tentang isi video..."
                    />
                  </div>

                  {/* Hashtags */}
                  <div className="input-group">
                    <label>Hashtag Viral</label>
                    <input
                      type="text"
                      className="caption-input"
                      value={u.uploadTags}
                      onChange={e => u.setUploadTags(e.target.value)}
                      placeholder="#Shorts #FYP #Trending #Viral"
                    />
                  </div>

                  {/* Scheduling Switch */}
                  <div className="schedule-box">
                    <div className="schedule-header">
                      <div className="schedule-info">
                        <span className="schedule-icon">🕒</span>
                        <div>
                          <span className="schedule-title">Jadwalkan Publikasi (Schedule)</span>
                          <span className="schedule-desc">Atur tanggal & jam tayang otomatis di YouTube Studio</span>
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

                  {/* Auto-Publish Mode Selector */}
                  <div className="publish-mode-selector animate-in">
                    <label className="mode-label">Mode Otomatisasi YouTube Shorts:</label>
                    <div className="publish-mode-options">
                      <div
                        className={`publish-mode-card ${u.autoPublishMode ? 'selected' : ''}`}
                        onClick={() => u.setAutoPublishMode(true)}
                      >
                        <div className="mode-card-header">
                          <span className="mode-icon">🚀</span>
                          <span className="mode-title">Full Auto (Hands-Free)</span>
                          <span className="mode-badge-rec">Rekomendasi</span>
                        </div>
                        <p className="mode-desc">
                          Otomatis upload video, isi judul & deskripsi, klik 'Berikutnya' sampai 'Publikasikan' selesai 100%.
                        </p>
                      </div>

                      <div
                        className={`publish-mode-card ${!u.autoPublishMode ? 'selected' : ''}`}
                        onClick={() => u.setAutoPublishMode(false)}
                      >
                        <div className="mode-card-header">
                          <span className="mode-icon">🔍</span>
                          <span className="mode-title">Review Sebelum Terbit</span>
                        </div>
                        <p className="mode-desc">
                          Otomatis upload & isi form, lalu berhenti di langkah akhir agar Anda bisa cek sebelum klik Publikasikan.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Upload Step-by-Step Guidance */}
                  <div className="upload-step-guide animate-in">
                    <div className="guide-header">
                      <span>🤖</span>
                      <strong>100% Otomatisasi YouTube Studio:</strong>
                    </div>
                    <p className="guide-text">
                      1. Klik tombol merah di bawah &rarr; Tab YouTube Studio terbuka.<br/>
                      2. Ekstensi otomatis <strong>menginjeksi file video klip</strong> ke YouTube Studio tanpa perlu drag manual.<br/>
                      3. Ekstensi otomatis <strong>mengisi Judul, Deskripsi, Hashtag #{u.channelName ? u.channelName.replace(/\s+/g, '') : 'Channel'}, Usia</strong>, lalu <strong>menekan 'Berikutnya' hingga video terupload & selesai</strong>!
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="yt-action-buttons">
                    <button
                      type="button"
                      className="submit-btn yt-direct-upload-btn"
                      onClick={u.handleUploadToYouTubeShorts}
                    >
                      <span>🚀</span> {u.autoPublishMode ? 'Auto-Upload & Publikasikan ke YouTube' : 'Auto-Upload & Review di YouTube'}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn copy-all-btn"
                      onClick={u.handleCopyAllCaption}
                      title="Salin semua teks ke clipboard"
                    >
                      📋 Salin Teks
                    </button>
                  </div>
                </div>
              </div>

              {/* Other Platforms Section */}
              <div className="card">
                <div className="section-header">
                  <h3>Platform Lainnya (TikTok, Instagram, Facebook)</h3>
                  <p className="section-desc">Aktifkan platform yang diinginkan untuk membuka tab upload simultan.</p>
                </div>

                <div className="platform-toggles">
                  {PLATFORMS.map(p => (
                    <div key={p.key} className={`platform-toggle-item ${u.enabledPlatforms[p.key] ? 'enabled' : ''}`}>
                      <div className="platform-toggle-info">
                        <span className="platform-toggle-icon">{p.icon}</span>
                        <div>
                          <span className="platform-toggle-name">{p.name}</span>
                          <span className="platform-toggle-desc">{p.desc}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`toggle-switch ${u.enabledPlatforms[p.key] ? 'on' : ''}`}
                        onClick={() => u.togglePlatform(p.key)}
                        aria-label={`Toggle ${p.name}`}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected clip summary */}
              <div className="card upload-summary">
                <div className="upload-summary-clip">
                  <span className="upload-clip-icon">🎬</span>
                  <div>
                    <h4>{u.selectedClip.title}</h4>
                    <p>{u.selectedClip.durationFormatted} · {u.selectedClip.fileSizeMB} MB · {u.selectedClip.framing === 'blur' ? 'Blur BG' : 'Crop 9:16'}</p>
                  </div>
                </div>

                <button
                  type="button"
                  className="submit-btn upload-all-btn"
                  onClick={u.openAllPlatforms}
                  disabled={u.enabledCount === 0}
                >
                  🚀 Upload ke {u.enabledCount} Platform Sekaligus
                </button>

                <p className="upload-note">
                  File clip akan diunduh otomatis, lalu tab upload platform terpilih akan dibuka. Kamu tinggal drag & drop videonya.
                </p>
              </div>
            </>
          )}

          {!u.selectedClip && clips.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon-wrap"><span className="empty-icon">📭</span></div>
              <h3>Belum ada clip</h3>
              <p>Buat clip dulu sebelum upload</p>
              <button className="ghost-btn" onClick={onGoCreate}>✂️ Buat Clip</button>
            </div>
          )}

          {!u.selectedClip && clips.length > 0 && (
            <div className="empty-state">
              <div className="empty-icon-wrap"><span className="empty-icon">☝️</span></div>
              <h3>Pilih clip di atas</h3>
              <p>Pilih clip dari dropdown untuk melihat opsi upload simultan</p>
            </div>
          )}
        </>
      )}

      {/* BATCH MODE */}
      {u.uploadSubMode === 'batch' && (
        <div className="batch-scheduler-card card animate-in">
          <div className="section-header yt-card-header">
            <div className="yt-badge-title">
              <span className="yt-icon">🗓️</span>
              <div>
                <h3>Batch Scheduler & Multi-Video Auto Upload</h3>
                <p className="section-desc">
                  Upload beberapa video sekaligus. Ekstensi YouTube Studio akan mengupload dan menjadwalkan satu per satu otomatis sesuai jam interval yang dipilih.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="ai-caption-btn"
              onClick={u.handleGenerateBatchAICaptions}
              disabled={u.generatingBatchCaptions || u.selectedBatchClipIds.length === 0}
              title="Generate judul viral & tags AI untuk semua video terpilih"
            >
              {u.generatingBatchCaptions ? (
                <>
                  <span className="spinner-sm" /> Membuat AI Captions...
                </>
              ) : (
                <>
                  <span>✨</span> Buat AI Captions Semua ({u.selectedBatchClipIds.length})
                </>
              )}
            </button>
          </div>

          {u.uploadStatusMsg && (
            <div className={`upload-status-alert ${u.uploadStatusMsg.startsWith('❌') || u.uploadStatusMsg.startsWith('⚠️') ? 'alert-err' : 'alert-ok'}`}>
              {u.uploadStatusMsg}
            </div>
          )}

          {/* Batch Configuration Settings */}
          <div className="batch-config-grid">
            <div className="input-group">
              <label>Mulai Jadwal Pertama (Start Time)</label>
              <input
                type="datetime-local"
                className="schedule-datetime-input"
                value={u.batchStartTime}
                onChange={e => u.setBatchStartTime(e.target.value)}
              />
              <span className="input-hint">Waktu tayang video urutan pertama (#1)</span>
            </div>

            <div className="input-group">
              <label>Interval Waktu Antar Video</label>
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
              <span className="input-hint">Video berikutnya otomatis tayang tiap +{u.batchIntervalHours} jam</span>
            </div>

            <div className="input-group">
              <label>Kuota Harian (ramah algoritma)</label>
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
                  : 'Tanpa batas harian — semua video dijadwalkan berurutan sesuai interval'}
              </span>
            </div>
          </div>

          {/* Creator Name Field */}
          <div className="input-group">
            <div className="label-row">
              <label>Nama Channel / Kreator</label>
              <span className="input-hint">— disisipkan otomatis di tag setiap video</span>
            </div>
            <div className="input-wrapper">
              <span className="input-icon">📢</span>
              <input
                type="text"
                value={u.channelName}
                onChange={e => {
                  u.setChannelName(e.target.value);
                  localStorage.setItem('yt_clipper_channel', e.target.value);
                }}
                placeholder="Nama channel Anda (contoh: Windah Basudara)..."
              />
            </div>
          </div>

          {/* Queue Header & Select All */}
          <div className="batch-select-all-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={clips.length > 0 && u.selectedBatchClipIds.length === clips.length}
                onChange={u.toggleSelectAllBatch}
              />
              <span>Pilih Semua Klip ({u.selectedBatchClipIds.length}/{clips.length})</span>
            </label>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Total {u.selectedBatchClipIds.length} video dalam antrean
            </span>
          </div>

          {/* Queue Items */}
          {clips.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📭</span>
              <p>Belum ada clip yang dibuat di history.</p>
              <button className="ghost-btn" onClick={onGoCreate}>✂️ Buat Clip Baru</button>
            </div>
          ) : (
            <div className="batch-queue-list">
              {clips.map((clip) => {
                const isSelected = u.selectedBatchClipIds.includes(clip.id);
                const queueIndex = u.selectedBatchClipIds.indexOf(clip.id);
                const schedTime = isSelected ? u.getClipScheduledTime(clip.id, queueIndex) : '';
                const customCap = u.batchCaptions[clip.id];

                return (
                  <div
                    key={clip.id}
                    className={`batch-queue-item ${isSelected ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => u.toggleSelectBatchClip(clip.id)}
                      style={{ marginTop: '5px', cursor: 'pointer' }}
                    />

                    {isSelected && (
                      <div className="queue-index-badge">
                        #{queueIndex + 1}
                      </div>
                    )}

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
                                  description: clip.transcript || 'Video Shorts seru!',
                                  hashtags: ['#Shorts', '#Viral'],
                                }),
                                title: val,
                              }
                            }));
                          }}
                          placeholder="Judul YouTube Shorts..."
                        />
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {clip.durationFormatted}
                        </span>
                      </div>

                      {isSelected && (
                        <div className="queue-item-schedule-row">
                          <span className="schedule-pill-badge">
                            🕒 Jadwal: {formatScheduleDisplay(schedTime)}
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

          {/* Guidance Box */}
          <div className="upload-step-guide animate-in">
            <div className="guide-header">
              <span>🤖</span>
              <strong>Bagaimana Batch Scheduler Berjalan Otomatis:</strong>
            </div>
            <p className="guide-text">
              1. Ekstensi YouTube Studio akan membuka video pertama (#1), mengupload, mengisi Judul/Deskripsi/Tag, dan <strong>menyetel jadwal jam {formatScheduleDisplay(u.getClipScheduledTime(u.selectedBatchClipIds[0] || '', 0))}</strong>.<br/>
              2. Saat video #1 selesai dijadwalkan, ekstensi otomatis <strong>melanjutkan ke video #2</strong> (+{u.batchIntervalHours} jam berikutnya{u.batchDailyQuota > 0 ? `, maks ${u.batchDailyQuota}/hari` : ''}), lalu #3, dan seterusnya sampai semua video selesai terjadwal tanpa perlu Anda klik berulang kali!
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="button"
            className="submit-btn batch-all-btn"
            onClick={u.handleStartBatchUpload}
            disabled={u.selectedBatchClipIds.length === 0 || u.batchUploading}
          >
            {u.batchUploading ? '⏳ Mengirim antrean...' : `🚀 Jadwalkan & Upload ${u.selectedBatchClipIds.length} Video ke YouTube Studio`}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
            <input
              type="checkbox"
              checked={u.saveDiskBackup}
              onChange={e => u.setSaveDiskBackup(e.target.checked)}
            />
            <span>Simpan juga backup ke disk (tidak wajib — upload Studio mengambil file langsung dari server)</span>
          </label>
        </div>
      )}
      </>
      )}
    </div>
  );
}
