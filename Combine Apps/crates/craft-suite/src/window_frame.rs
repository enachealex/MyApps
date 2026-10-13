//! Keeps the window, which draws its own title bar, truly borderless on Windows.
//!
//! Adapted from PhotoCraft's `apps/photocraft/src/window_frame.rs` (Apache-2.0 OR MIT,
//! https://github.com/storytold/photocraft), which found both problems:
//!
//! - winit 0.30 gives an undecorated window the `WS_CAPTION | WS_BORDER` styles. On some systems
//!   the compositor still reserves that frame: the content is drawn offset by the caption while
//!   the pointer keeps the un-offset coordinates (PhotoCraft #2246). The guard strips them, and
//!   checks every frame because winit puts them back whenever it changes the window flags.
//! - A window maximized without a caption covers the whole monitor, taskbar included; the shell
//!   then treats it as full screen and drops the taskbar's backdrop (a black band on Windows 11,
//!   PhotoCraft #3144). The guard trims such a maximize back to the work area.

pub use platform::Guard;

#[cfg(target_os = "windows")]
mod platform {
    use eframe::wgpu::rwh::{HasWindowHandle, RawWindowHandle};
    use winsafe::{HWND, HwndPlace, POINT, SIZE, co};

    pub struct Guard(HWND);

    impl Guard {
        /// `None` when the window has its system title bar or its handle can't be found.
        pub fn new(cc: &eframe::CreationContext<'_>, custom_titlebar: bool) -> Option<Self> {
            if !custom_titlebar {
                return None;
            }
            let target = match cc.window_handle().ok()?.as_raw() {
                RawWindowHandle::Win32(h) => h.hwnd.get(),
                _ => return None,
            };
            let guard = Self(find_window(target)?);
            guard.reapply();
            Some(guard)
        }

        /// Once per frame: cheap when nothing changed.
        pub fn reapply(&self) {
            strip(&self.0);
            keep_clear_of_the_taskbar(&self.0);
        }
    }

    /// The top-level window with the given raw handle. `EnumWindows` hands out real `HWND`s, so
    /// this finds winit's window without wrapping a raw handle (which needs `unsafe`).
    fn find_window(target: isize) -> Option<HWND> {
        let mut found = None;
        let _ = winsafe::EnumWindows(|hwnd| {
            if hwnd.ptr() as isize == target {
                found = Some(hwnd);
                false
            } else {
                true
            }
        });
        found
    }

    fn strip(hwnd: &HWND) {
        let style = hwnd.style();
        let without = borderless(style);
        if without.raw() == style.raw() {
            return;
        }
        hwnd.set_style(without);
        let _ = hwnd.SetWindowPos(
            HwndPlace::None,
            POINT::new(),
            SIZE::new(),
            co::SWP::FRAMECHANGED | co::SWP::NOMOVE | co::SWP::NOSIZE | co::SWP::NOZORDER | co::SWP::NOACTIVATE,
        );
    }

    /// How far a parked maximize reaches past its monitor: the resize border (about 8 pt at
    /// 100 %, more with DPI). Further out, the window is being dragged or snapped, not parked.
    const FRAME: i32 = 32;

    fn keep_clear_of_the_taskbar(hwnd: &HWND) {
        if !hwnd.IsZoomed() {
            return;
        }
        let (Ok(r), Ok(mi)) = (hwnd.GetWindowRect(), hwnd.MonitorFromWindow(co::MONITOR::DEFAULTTONEAREST).GetMonitorInfo()) else {
            return;
        };
        let (m, w) = (mi.rcMonitor, mi.rcWork);
        let Some(height) = clamped_height((r.left, r.top, r.right, r.bottom), (m.left, m.top, m.right, m.bottom), (w.left, w.top, w.right, w.bottom)) else {
            return;
        };
        let _ = hwnd.SetWindowPos(
            HwndPlace::None,
            POINT::new(),
            SIZE { cx: r.right - r.left, cy: height },
            co::SWP::NOMOVE | co::SWP::NOZORDER | co::SWP::NOACTIVATE,
        );
    }

    /// The height that ends a parked maximize at the taskbar, or `None` when it already does or
    /// `rect` isn't parked at its maximize place. All rects are `(left, top, right, bottom)`.
    pub(super) fn clamped_height(rect: (i32, i32, i32, i32), monitor: (i32, i32, i32, i32), work: (i32, i32, i32, i32)) -> Option<i32> {
        let (l, t, r, b) = rect;
        let (ml, mt, mr, _) = monitor;
        let (_, _, _, wb) = work;
        let side = ml - l;
        if !(0..=FRAME).contains(&side) || !(0..=FRAME).contains(&(mt - t)) || !(0..=FRAME).contains(&(r - mr)) {
            return None;
        }
        if b <= wb + side {
            return None;
        }
        Some(wb + side - t)
    }

    /// `style` without the OS caption and border; the sizing border (`WS_THICKFRAME`) stays, so
    /// edge resizing and Aero snap keep working.
    pub(super) fn borderless(style: co::WS) -> co::WS {
        style & !(co::WS::CAPTION | co::WS::BORDER)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub struct Guard;

    impl Guard {
        pub fn new(_cc: &eframe::CreationContext<'_>, _custom_titlebar: bool) -> Option<Self> {
            None
        }

        pub fn reapply(&self) {}
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::platform::{borderless, clamped_height};
    use winsafe::co;

    #[test]
    fn the_borderless_style_drops_the_caption_and_border_only() {
        let decorated = co::WS::CAPTION | co::WS::BORDER | co::WS::SYSMENU | co::WS::THICKFRAME | co::WS::MAXIMIZEBOX | co::WS::MINIMIZEBOX;
        let bare = borderless(decorated);
        assert!(!bare.has(co::WS::CAPTION) && !bare.has(co::WS::BORDER));
        assert!(bare.has(co::WS::THICKFRAME) && bare.has(co::WS::MAXIMIZEBOX) && bare.has(co::WS::SYSMENU));
        assert_eq!(bare.raw(), borderless(bare).raw());
    }

    #[test]
    fn a_maximize_over_the_taskbar_is_trimmed_and_others_are_left_alone() {
        let (monitor, work) = ((0, 0, 1920, 1080), (0, 0, 1920, 1046));
        assert_eq!(clamped_height((-7, -7, 1927, 1087), monitor, work), Some(1046 + 7 + 7));
        assert_eq!(clamped_height((-8, -8, 1928, 1054), monitor, work), None, "already clear");
        assert_eq!(clamped_height((100, 200, 1100, 900), monitor, work), None, "not maximized");
    }
}
