//! Windows process loopback: the system audio mix without NexQ's own sound.
//!
//! Plain WASAPI loopback records everything played on the output device,
//! answers NexQ reads aloud included, so they came back as the other party's
//! words. Process loopback (Windows 10 2004+) records every process except
//! NexQ's process tree: the WebView2 processes, where the voice plays, are
//! children of NexQ's.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use windows::core::{implement, Interface, IUnknown, HRESULT};
use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, IAgileObject, IAgileObject_Impl, BLOB, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, GetCurrentProcessId, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;

use super::AudioChunk;

/// The format asked of the audio engine (it converts the mix to it).
const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
/// Engine buffer: 200 ms, in 100 ns units.
const BUFFER_DURATION: i64 = 2_000_000;
const ACTIVATE_TIMEOUT: Duration = Duration::from_secs(5);
const WAVE_FORMAT_PCM: u16 = 1;

/// Whether the running capture leaves NexQ's own sound out.
static EXCLUDES_SELF: AtomicBool = AtomicBool::new(false);

/// Whether the system capture running now leaves out what NexQ plays (its voice).
pub fn excludes_self() -> bool {
    EXCLUDES_SELF.load(Ordering::Relaxed)
}

#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Activated {
    done: std::sync::mpsc::Sender<()>,
}

// Agile: Windows calls the handler from any thread.
impl IAgileObject_Impl for Activated_Impl {}

impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
    fn ActivateCompleted(&self, _operation: windows::core::Ref<IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        let _ = self.done.send(());
        Ok(())
    }
}

/// Opens an audio client on everything but NexQ's process tree.
unsafe fn activate_excluding_self() -> Result<IAudioClient, String> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: GetCurrentProcessId(),
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // ManuallyDrop: the blob points at `params` on the stack, which
    // PropVariantClear must never free.
    let blob = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &mut params as *mut _ as *mut u8,
                    },
                },
            }),
        },
    });

    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let handler: IActivateAudioInterfaceCompletionHandler = Activated { done: done_tx }.into();
    let operation = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&*blob as *const PROPVARIANT),
        &handler,
    )
    .map_err(|e| format!("ActivateAudioInterfaceAsync: {e}"))?;

    done_rx
        .recv_timeout(ACTIVATE_TIMEOUT)
        .map_err(|_| "Process loopback activation timed out".to_string())?;
    let mut result = HRESULT(0);
    let mut unknown: Option<IUnknown> = None;
    operation
        .GetActivateResult(&mut result, &mut unknown)
        .map_err(|e| format!("GetActivateResult: {e}"))?;
    result.ok().map_err(|e| format!("Process loopback activation: {e}"))?;
    unknown
        .ok_or_else(|| "Process loopback returned no audio client".to_string())?
        .cast::<IAudioClient>()
        .map_err(|e| format!("IAudioClient: {e}"))
}

/// Captures until `stop_flag`, sending 16 kHz chunks like the WASAPI loopback.
/// Reports on `ready` once capture runs, or the error that stopped it starting.
pub fn run(
    tx: mpsc::Sender<AudioChunk>,
    stop_flag: Arc<AtomicBool>,
    ready: &std::sync::mpsc::Sender<Result<(), String>>,
    send_chunk: fn(&[i16], u32, u16, &mpsc::Sender<AudioChunk>),
) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| format!("CoInitializeEx: {e}"))?;
        let result = capture(&tx, &stop_flag, ready, send_chunk);
        EXCLUDES_SELF.store(false, Ordering::Relaxed);
        CoUninitialize();
        result
    }
}

unsafe fn capture(
    tx: &mpsc::Sender<AudioChunk>,
    stop_flag: &AtomicBool,
    ready: &std::sync::mpsc::Sender<Result<(), String>>,
    send_chunk: fn(&[i16], u32, u16, &mpsc::Sender<AudioChunk>),
) -> Result<(), String> {
    let client = activate_excluding_self()?;
    let block_align = CHANNELS * 2;
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM,
        nChannels: CHANNELS,
        nSamplesPerSec: SAMPLE_RATE,
        nAvgBytesPerSec: SAMPLE_RATE * block_align as u32,
        nBlockAlign: block_align,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            BUFFER_DURATION,
            0,
            &format,
            None,
        )
        .map_err(|e| format!("IAudioClient::Initialize: {e}"))?;
    let event = CreateEventW(None, false, false, None).map_err(|e| format!("CreateEventW: {e}"))?;
    let run = (|| -> Result<(), String> {
        client.SetEventHandle(event).map_err(|e| format!("SetEventHandle: {e}"))?;
        let capture: IAudioCaptureClient = client.GetService().map_err(|e| format!("IAudioCaptureClient: {e}"))?;
        client.Start().map_err(|e| format!("IAudioClient::Start: {e}"))?;
        EXCLUDES_SELF.store(true, Ordering::Relaxed);
        log::info!("System audio: capturing every app except NexQ (process loopback)");
        let _ = ready.send(Ok(()));

        let mut pcm: Vec<i16> = Vec::new();
        while !stop_flag.load(Ordering::Relaxed) {
            if WaitForSingleObject(event, 100) != WAIT_OBJECT_0 {
                continue;
            }
            loop {
                let frames_ready = capture.GetNextPacketSize().map_err(|e| format!("GetNextPacketSize: {e}"))?;
                if frames_ready == 0 {
                    break;
                }
                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(|e| format!("GetBuffer: {e}"))?;
                let samples = frames as usize * CHANNELS as usize;
                pcm.clear();
                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                    pcm.resize(samples, 0);
                } else {
                    pcm.extend_from_slice(std::slice::from_raw_parts(data as *const i16, samples));
                }
                capture.ReleaseBuffer(frames).map_err(|e| format!("ReleaseBuffer: {e}"))?;
                send_chunk(&pcm, SAMPLE_RATE, CHANNELS, tx);
            }
        }
        let _ = client.Stop();
        Ok(())
    })();
    let _ = CloseHandle(event);
    log::info!("System audio (process loopback) stopped");
    run
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::AudioSource;
    use std::process::Command;

    fn keep(pcm: &[i16], _rate: u32, _channels: u16, tx: &mpsc::Sender<AudioChunk>) {
        let _ = tx.try_send(AudioChunk { pcm_data: pcm.to_vec(), source: AudioSource::System, timestamp_ms: 0, is_speech: false });
    }

    const SPEAK: &str = "Add-Type -AssemblyName System.Speech; \
        (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('Test de capture, un deux trois quatre cinq')";

    /// Loudest 16-bit sample captured meanwhile.
    fn loudest(rx: &mut mpsc::Receiver<AudioChunk>) -> i32 {
        let mut peak = 0i32;
        while let Ok(chunk) = rx.try_recv() {
            peak = peak.max(chunk.pcm_data.iter().map(|s| (*s as i32).abs()).max().unwrap_or(0));
        }
        peak
    }

    /// Plays speech on the default output: run by hand, with sound on.
    /// `cargo test --no-default-features --lib process_loopback -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn leaves_out_its_own_process_tree_but_hears_other_apps() {
        let (tx, mut rx) = mpsc::channel(10_000);
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let stop2 = stop.clone();
        let worker = std::thread::spawn(move || run(tx, stop2, &ready_tx, keep));
        ready_rx.recv_timeout(Duration::from_secs(5)).expect("capture started").expect("capture ok");
        assert!(excludes_self());

        // Speech from a child of this process: left out.
        let _ = loudest(&mut rx);
        Command::new("powershell").args(["-NoProfile", "-Command", SPEAK]).status().expect("child speech");
        let own = loudest(&mut rx);

        // The same speech from another process tree (started by WMI): heard.
        let detached = format!(
            "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{{CommandLine='powershell -NoProfile -Command \"{}\"'}} | Out-Null",
            SPEAK.replace('\'', "''")
        );
        Command::new("powershell").args(["-NoProfile", "-Command", &detached]).status().expect("detached speech");
        std::thread::sleep(Duration::from_secs(6));
        let other = loudest(&mut rx);

        stop.store(true, Ordering::Relaxed);
        worker.join().unwrap().unwrap();
        println!("own process tree peak: {own}, other app peak: {other}");
        assert!(own < 300, "NexQ's own sound was captured (peak {own})");
        assert!(other > 1000, "another app's sound wasn't captured (peak {other})");
    }
}
