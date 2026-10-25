using PdfSharp.Fonts;
using PdfStudio.Services;
using PdfStudio.UI;
using System.Diagnostics;

namespace PdfStudio;

internal static class Program
{
    private const int MinSplashMs = 900;     // avoid a one-frame flash when the machine is fast
    private const int MaxSplashMs = 15000;   // hard failsafe: the loader can never stay on screen longer than this

    [STAThread]
    private static void Main()
    {
        // If a protected legacy install could not replace its own EXE during the V3 migration, route the old
        // shortcut to the verified user-local portable build instead of reopening the obsolete C# UI.
        if (UpdateService.TryLaunchPortableMigration()) return;

        UpdateService.CleanupLeftovers();   // removes old updater leftovers without discarding a postponed update
        BackgroundUpdateService.Initialize(); // restore a verified update, if the user chose Update later
        ApplicationConfiguration.Initialize();
        Theme.Init();
        Theme.SetDark(AppSettings.LoadDark());
        Application.ThreadException += (_, e) => MessageBox.Show(e.Exception.Message, "PDF Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => MessageBox.Show(e.ExceptionObject?.ToString() ?? "Unknown error", "PDF Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);

        // 1. Loader first, on its own thread, so something clean is on screen immediately.
        var clock = Stopwatch.StartNew();
        var splash = SplashForm.Start();

        MainForm main;
        try
        {
            splash?.SetStatus("Loading components…");
            // PDFsharp (core build) needs this to find installed Windows fonts for text overlays, page numbers and watermarks.
            GlobalFontSettings.UseWindowsFontsUnderWindows = true;

            // 2. Build the real window completely (still invisible) so half-painted frames are never seen.
            splash?.SetStatus("Building the interface…");
            main = new MainForm { Opacity = 0 };
        }
        catch
        {
            splash?.CloseSplash();
            throw;
        }

        var finished = false;
        void Finish()
        {
            if (finished) return;
            finished = true;
            main.Opacity = 1;
            splash?.CloseSplash();          // close the loader first ...
            main.WindowState = main.WindowState == FormWindowState.Minimized ? FormWindowState.Normal : main.WindowState;
            main.Activate();                // ... then make sure the app is in front and focused
            main.BringToFront();
        }

        // 3. After the window has done its first full layout AND the message loop is idle, wait out the
        //    minimum splash time, then reveal the app and close the loader.
        main.Shown += (_, _) =>
        {
            splash?.SetStatus("Almost ready…");
            main.Update();

            void OnIdle(object? s, EventArgs e)
            {
                Application.Idle -= OnIdle;
                var delay = (int)Math.Max(1, MinSplashMs - clock.ElapsedMilliseconds);
                var wait = new System.Windows.Forms.Timer { Interval = delay };
                wait.Tick += (_, _) => { wait.Stop(); wait.Dispose(); Finish(); };
                wait.Start();
            }
            Application.Idle += OnIdle;
        };

        // Failsafe: whatever happens, the loader goes away and the app appears.
        var failsafe = new System.Windows.Forms.Timer { Interval = MaxSplashMs };
        failsafe.Tick += (_, _) => { failsafe.Stop(); failsafe.Dispose(); Finish(); };
        failsafe.Start();

        main.FormClosed += (_, _) => splash?.CloseSplash();
        Application.Run(main);
        splash?.CloseSplash();
    }
}
