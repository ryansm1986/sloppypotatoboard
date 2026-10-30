# Lists Windows audio endpoints and switches the default recording device.
#   AudioDevices.ps1 list
#   AudioDevices.ps1 set-default <endpoint id>
param([string]$Command = 'list', [string]$Id = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;

namespace SloppyPotato
{
    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey { public Guid fmtid; public int pid; }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointerValue;
        [FieldOffset(16)] public IntPtr padding;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorCom { }

    // Undocumented but stable since Windows 7; this is how the Sound control panel sets defaults.
    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat(IntPtr a, IntPtr b);
        [PreserveSig] int GetDeviceFormat(IntPtr a, int b, IntPtr c);
        [PreserveSig] int ResetDeviceFormat(IntPtr a);
        [PreserveSig] int SetDeviceFormat(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int GetProcessingPeriod(IntPtr a, int b, IntPtr c, IntPtr d);
        [PreserveSig] int SetProcessingPeriod(IntPtr a, IntPtr b);
        [PreserveSig] int GetShareMode(IntPtr a, IntPtr b);
        [PreserveSig] int SetShareMode(IntPtr a, IntPtr b);
        [PreserveSig] int GetPropertyValue(IntPtr a, int b, IntPtr c, IntPtr d);
        [PreserveSig] int SetPropertyValue(IntPtr a, int b, IntPtr c, IntPtr d);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
        [PreserveSig] int SetEndpointVisibility(IntPtr a, int b);
    }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    public class PolicyConfigClient { }

    public static class Endpoints
    {
        static string Esc(string s)
        {
            if (s == null) return "";
            var sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') { sb.Append('\\'); sb.Append(c); }
                else if (c < ' ') sb.AppendFormat("\\u{0:x4}", (int)c);
                else sb.Append(c);
            }
            return sb.ToString();
        }

        public static string List()
        {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
            var key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
            var sb = new StringBuilder("[");
            bool first = true;
            for (int flow = 0; flow < 2; flow++)
            {
                string defaultId = null;
                IMMDevice def;
                if (enumerator.GetDefaultAudioEndpoint(flow, 0, out def) == 0 && def != null) def.GetId(out defaultId);

                IMMDeviceCollection devices;
                Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(flow, 1, out devices));
                int count;
                devices.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    IMMDevice dev;
                    if (devices.Item(i, out dev) != 0) continue;
                    string id;
                    dev.GetId(out id);
                    string name = "";
                    IPropertyStore store;
                    if (dev.OpenPropertyStore(0, out store) == 0)
                    {
                        PropVariant pv;
                        if (store.GetValue(ref key, out pv) == 0 && pv.vt == 31) name = Marshal.PtrToStringUni(pv.pointerValue);
                    }
                    if (!first) sb.Append(",");
                    first = false;
                    sb.AppendFormat("{{\"id\":\"{0}\",\"name\":\"{1}\",\"flow\":\"{2}\",\"isDefault\":{3}}}",
                        Esc(id), Esc(name), flow == 0 ? "render" : "capture", id == defaultId ? "true" : "false");
                }
            }
            sb.Append("]");
            return sb.ToString();
        }

        public static void SetDefault(string id)
        {
            var policy = (IPolicyConfig)(new PolicyConfigClient());
            for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(id, role));
        }
    }
}
"@

Add-Type -TypeDefinition $source -Language CSharp

switch ($Command) {
    'list' { [SloppyPotato.Endpoints]::List() }
    'set-default' {
        if (-not $Id) { throw 'Missing endpoint id' }
        [SloppyPotato.Endpoints]::SetDefault($Id)
        [SloppyPotato.Endpoints]::List()
    }
    default { throw "Unknown command $Command" }
}
