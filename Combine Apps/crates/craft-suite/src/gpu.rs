//! The one GPU device every app in the window shares.
//!
//! Each upstream app tunes its own device; this is the union of what they ask for, and of the
//! driver workarounds they found:
//! - the adapter's own limits, textures capped at 16384 px (EffectCraft, PhotoCraft, CADCraft and
//!   PdfCraft all raise egui's 8192 px default for big images, pages and buffers);
//! - on Windows no OpenGL backend: creating it can crash inside AMD's driver before any error
//!   handling runs (FilmCraft, SoundCraft);
//! - on Windows Intel graphics through DirectX 12, others through Vulkan: Intel's Vulkan driver is
//!   known to crash (PhotoCraft), and DirectX 12's built-in shader compiler (FXC) rejects some
//!   effect shaders that Vulkan runs (FilmCraft);
//! - DirectX 12 shaders compiled with FXC, which is part of Windows, instead of whichever
//!   dxcompiler.dll the search path finds (VectorCraft, SoundCraft);
//! - no indirect-call validation: nothing draws indirectly, and its shader fails on some drivers
//!   (VectorCraft, PhotoCraft).
//!
//! `WGPU_BACKEND`, `WGPU_ADAPTER_NAME` and `WGPU_DX12_COMPILER` override these, as in every app.

use std::sync::Arc;

use eframe::egui_wgpu::WgpuSetup;
use eframe::wgpu;

pub fn configure(options: &mut eframe::NativeOptions) {
    let WgpuSetup::CreateNew(create) = &mut options.wgpu_options.wgpu_setup else { return };
    let backend_from_env = wgpu::Backends::from_env();
    if cfg!(target_os = "windows") {
        create.instance_descriptor.backends = backend_from_env.unwrap_or(wgpu::Backends::DX12 | wgpu::Backends::VULKAN);
        create.instance_descriptor.backend_options.dx12.shader_compiler = wgpu::Dx12Compiler::from_env().unwrap_or(wgpu::Dx12Compiler::Fxc);
        if backend_from_env.is_none() && std::env::var_os("WGPU_ADAPTER_NAME").is_none() {
            create.native_adapter_selector = Some(Arc::new(pick_adapter));
        }
    }
    create.instance_descriptor.flags = (wgpu::InstanceFlags::from_build_config() - wgpu::InstanceFlags::VALIDATION_INDIRECT_CALL).with_env();
    create.device_descriptor = Arc::new(|adapter| wgpu::DeviceDescriptor {
        label: Some("craft-suite device"),
        required_limits: device_limits(adapter.limits()),
        ..Default::default()
    });
}

/// All the adapter offers, textures capped at 16384 px like the apps' own devices.
fn device_limits(adapter: wgpu::Limits) -> wgpu::Limits {
    wgpu::Limits { max_texture_dimension_2d: adapter.max_texture_dimension_2d.min(16384), ..adapter }
}

const INTEL: u32 = 0x8086;

/// What [`pick`] needs to know about an adapter.
#[derive(Clone, Copy, Debug)]
struct Candidate {
    vendor: u32,
    device_type: wgpu::DeviceType,
    backend: wgpu::Backend,
    shows_window: bool,
}

fn pick_adapter(adapters: &[wgpu::Adapter], surface: Option<&wgpu::Surface<'_>>) -> Result<wgpu::Adapter, String> {
    let candidates: Vec<Candidate> = adapters
        .iter()
        .map(|a| {
            let i = a.get_info();
            Candidate { vendor: i.vendor, device_type: i.device_type, backend: i.backend, shows_window: surface.is_none_or(|s| a.is_surface_supported(s)) }
        })
        .collect();
    let i = pick(&candidates).ok_or_else(|| format!("none of {} graphics adapters can show the window", adapters.len()))?;
    let info = adapters[i].get_info();
    log::info!("graphics: {} ({:?}, {:?})", info.name, info.backend, info.device_type);
    Ok(adapters[i].clone())
}

/// The adapter to use: one that can show the window, a dedicated GPU before an integrated one
/// before anything else, and per GPU the backend its driver is best at.
fn pick(candidates: &[Candidate]) -> Option<usize> {
    let kind = |t: wgpu::DeviceType| match t {
        wgpu::DeviceType::DiscreteGpu => 0,
        wgpu::DeviceType::IntegratedGpu => 1,
        wgpu::DeviceType::VirtualGpu | wgpu::DeviceType::Other => 2,
        wgpu::DeviceType::Cpu => 3,
    };
    let backend = |c: &Candidate| {
        let preferred = if c.vendor == INTEL { wgpu::Backend::Dx12 } else { wgpu::Backend::Vulkan };
        usize::from(c.backend != preferred)
    };
    candidates.iter().enumerate().filter(|(_, c)| c.shows_window).min_by_key(|(_, c)| (kind(c.device_type), backend(c))).map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wgpu::{Backend, DeviceType};

    fn c(vendor: u32, device_type: DeviceType, backend: Backend) -> Candidate {
        Candidate { vendor, device_type, backend, shows_window: true }
    }

    #[test]
    fn intel_graphics_go_through_directx_and_others_through_vulkan() {
        let intel = [c(INTEL, DeviceType::IntegratedGpu, Backend::Vulkan), c(INTEL, DeviceType::IntegratedGpu, Backend::Dx12)];
        assert_eq!(pick(&intel), Some(1));
        let nvidia = [c(0x10de, DeviceType::DiscreteGpu, Backend::Dx12), c(0x10de, DeviceType::DiscreteGpu, Backend::Vulkan)];
        assert_eq!(pick(&nvidia), Some(1));
    }

    #[test]
    fn a_dedicated_gpu_wins_and_software_comes_last() {
        let all =
            [c(0x1414, DeviceType::Cpu, Backend::Dx12), c(INTEL, DeviceType::IntegratedGpu, Backend::Dx12), c(0x1002, DeviceType::DiscreteGpu, Backend::Dx12)];
        assert_eq!(pick(&all), Some(2));
        assert_eq!(pick(&all[..1]), Some(0), "software when there is nothing else");
    }

    #[test]
    fn adapters_that_cannot_show_the_window_are_skipped() {
        let mut gpu = c(0x10de, DeviceType::DiscreteGpu, Backend::Vulkan);
        gpu.shows_window = false;
        assert_eq!(pick(&[gpu, c(INTEL, DeviceType::IntegratedGpu, Backend::Dx12)]), Some(1));
        assert_eq!(pick(&[gpu]), None);
    }

    #[test]
    fn textures_are_capped_and_everything_else_is_the_adapters() {
        let adapter = wgpu::Limits { max_texture_dimension_2d: 32768, max_buffer_size: 1 << 40, ..wgpu::Limits::default() };
        let limits = device_limits(adapter.clone());
        assert_eq!(limits.max_texture_dimension_2d, 16384);
        assert_eq!(limits.max_buffer_size, adapter.max_buffer_size);
        assert_eq!(device_limits(wgpu::Limits::default()).max_texture_dimension_2d, 8192);
    }
}
