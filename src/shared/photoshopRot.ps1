# BrandForge Photoshop 2027 fallback: read-only Running Object Table discovery.
# Runs only after normal GetObject / CreateObject both fail with COM error 429.
# No registry writes, no elevation, no third-party binaries or policy changes.
# The only accepted COM object must implement Photoshop's _Application IID.
$ErrorActionPreference = 'Stop'
try {
    $jsx = $env:BRANDFORGE_ROT_JSX
    $receipt = $env:BRANDFORGE_ROT_RECEIPT
    $requiredMajor = [string]$env:BRANDFORGE_REQUIRED_MAJOR
    if ($requiredMajor -notin @("0", "27", "28", "")) { throw "Invalid Photoshop version selection." }
    if ([string]::IsNullOrWhiteSpace($jsx) -or !(Test-Path -LiteralPath $jsx -PathType Leaf)) {
        throw 'The generated JSX worker does not exist.'
    }
    Add-Type -Language CSharp -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Reflection;

public static class BrandForgePhotoshopRot {
    // Photoshop scripting _Application IID, not the generic COM ProgID/CLSID.
    private static readonly Guid PhotoshopIid = new Guid("5DE90358-4D0B-4FA1-BA3E-C91BBA863F32");
    [DllImport("ole32.dll", PreserveSig = false)]
    private static extern void GetRunningObjectTable(uint reserved, out IRunningObjectTable rot);

    public static object Find(string required) {
        IRunningObjectTable rot;
        GetRunningObjectTable(0, out rot);
        IEnumMoniker iterator;
        rot.EnumRunning(out iterator);
        IMoniker[] items = new IMoniker[1];
        object possible2026 = null;
        while (iterator.Next(1, items, IntPtr.Zero) == 0) {
            object current = null;
            try { rot.GetObject(items[0], out current); } catch { continue; }
            if (current == null) continue;
            IntPtr unknown = IntPtr.Zero, expected = IntPtr.Zero;
            try {
                unknown = Marshal.GetIUnknownForObject(current);
                Guid iid = PhotoshopIid;
                int status = Marshal.QueryInterface(unknown, ref iid, out expected);
                if (status != 0 || expected == IntPtr.Zero) continue;
                // Never dispatch commands to an arbitrary ROT object: interface AND version must match.
                object value = current.GetType().InvokeMember("Version", BindingFlags.GetProperty, null, current, null);
                string version = Convert.ToString(value) ?? "";
                if (required == "27" && version.StartsWith("27.", StringComparison.Ordinal)) return current;
                if (required == "28" && version.StartsWith("28.", StringComparison.Ordinal)) return current;
                if ((String.IsNullOrEmpty(required) || required == "0") && version.StartsWith("28.", StringComparison.Ordinal)) return current;
                if ((String.IsNullOrEmpty(required) || required == "0") && version.StartsWith("27.", StringComparison.Ordinal) && possible2026 == null)
                    possible2026 = current;
            } catch { /* Broken, unrelated or incompatible COM object. */ }
            finally {
                if (expected != IntPtr.Zero) Marshal.Release(expected);
                if (unknown != IntPtr.Zero) Marshal.Release(unknown);
            }
        }
        return possible2026;
    }
}
'@
    $ps = [BrandForgePhotoshopRot]::Find($requiredMajor)
    if ($null -eq $ps) {
        Write-Output ('BRANDFORGE_ROT_UNAVAILABLE|No compatible Photoshop _Application object is available in the Windows Running Object Table for selection ' + $requiredMajor + '.')
        exit 54
    }
    $flagsGet = [System.Reflection.BindingFlags]::GetProperty
    $flagsCall = [System.Reflection.BindingFlags]::InvokeMethod
    $version = [string]$ps.GetType().InvokeMember('Version', $flagsGet, $null, $ps, @())
    if ($version -notmatch '^(27|28)\.' -or (($requiredMajor -eq '27' -or $requiredMajor -eq '28') -and !$version.StartsWith($requiredMajor + '.'))) {
        throw 'The discovered COM application has an unexpected Photoshop version.'
    }
    $invocation = 'ROT-DoJavaScriptFile'
    try {
        $null = $ps.GetType().InvokeMember('DoJavaScriptFile', $flagsCall, $null, $ps, @($jsx))
    } catch {
        # Avoid rerunning a worker that may have already completed its side effects.
        if ([string]::IsNullOrWhiteSpace($receipt) -or !(Test-Path -LiteralPath $receipt -PathType Leaf)) {
            if ([string]::IsNullOrWhiteSpace($receipt)) {
                throw 'DoJavaScriptFile failed; no completion receipt was provided, so replay is unsafe.'
            }
            $pathLiteral = (($jsx -replace '\\', '/') | ConvertTo-Json -Compress)
            $expression = '$.evalFile(new File(' + $pathLiteral + '));'
            $invocation = 'ROT-DoJavaScript-evalFile'
            $null = $ps.GetType().InvokeMember('DoJavaScript', $flagsCall, $null, $ps, @($expression))
        }
    }
    Write-Output ('BRANDFORGE_CONNECTED|' + $version + '|rot|' + $invocation)
    exit 0
} catch {
    $detail = $_.Exception.Message -replace '[\r\n\|]', ' '
    Write-Output ('BRANDFORGE_ROT_ERROR|' + $detail)
    exit 54
}
