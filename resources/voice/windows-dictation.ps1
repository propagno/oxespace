# OxeVoice Windows helper: WinRT speech dictation for Windows PowerShell 5.1.
# A fixed program, not an evaluator. Talks JSON lines on stdout; reads "stop" on stdin.
# PowerShell 5.1 cannot subscribe to WinRT events, so listen mode loops RecognizeAsync instead of
# using ContinuousRecognitionSession / HypothesisGenerated.
param(
    [Parameter(Mandatory = $true)][ValidateSet('probe', 'listen')][string]$Mode,
    [string]$Language
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# HRESULT 0x80045509 (-2147199735): the OS online speech recognition privacy setting is off.
$SpeechPrivacyOff = '0x80045509'

function Write-Line($obj) {
    $json = ConvertTo-Json -InputObject $obj -Compress -Depth 4
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Get-HResult($err) {
    $e = $err.Exception
    while ($null -ne $e.InnerException) { $e = $e.InnerException }
    return ('0x{0:X8}' -f [int]$e.HResult)
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [void][Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
    [void][Windows.Media.SpeechRecognition.SpeechRecognitionResult, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
    [void][Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
    [void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0]

    function Get-Task($operation, [Type]$resultType) {
        return $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    }

    if ($Mode -eq 'probe') {
        $languages = @()
        foreach ($l in [Windows.Media.SpeechRecognition.SpeechRecognizer]::SupportedTopicLanguages) {
            $languages += [string]$l.LanguageTag
        }
        $system = [string][Windows.Media.SpeechRecognition.SpeechRecognizer]::SystemSpeechLanguage.LanguageTag
        Write-Line ([ordered]@{
                type           = 'probe'
                available      = ($languages.Count -gt 0)
                languages      = @($languages)
                systemLanguage = $system
            })
        exit 0
    }

    # listen
    if ([string]::IsNullOrEmpty($Language)) {
        $recognizer = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer
    }
    else {
        $lang = New-Object Windows.Globalization.Language($Language)
        $recognizer = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer($lang)
    }

    $constraint = New-Object Windows.Media.SpeechRecognition.SpeechRecognitionTopicConstraint(
        [Windows.Media.SpeechRecognition.SpeechRecognitionScenario]::Dictation, 'dictation')
    $recognizer.Constraints.Add($constraint)

    $compileTask = Get-Task ($recognizer.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
    $compileTask.Wait()

    Write-Line ([ordered]@{ type = 'listening' })

    $stopTask = [Console]::In.ReadLineAsync()
    $stop = $false

    while (-not $stop) {
        $operation = $recognizer.RecognizeAsync()
        $task = Get-Task $operation ([Windows.Media.SpeechRecognition.SpeechRecognitionResult])

        while (-not $task.Wait(200)) {
            if ($stopTask.IsCompleted) {
                $stop = $true
                break
            }
        }

        if ($stopTask.IsCompleted) { $stop = $true }

        if ($stop -and -not $task.IsCompleted) {
            try { $operation.Cancel() } catch { }
            [void]$task.Wait(1500)
        }

        if ($task.IsCompleted -and -not $task.IsFaulted -and -not $task.IsCanceled) {
            $text = [string]$task.Result.Text
            if (-not [string]::IsNullOrWhiteSpace($text)) {
                Write-Line ([ordered]@{ type = 'final'; text = $text })
            }
        }
    }

    $recognizer.Dispose()
    Write-Line ([ordered]@{ type = 'ended' })
    exit 0
}
catch {
    $hresult = Get-HResult $_
    if ($hresult -eq '0x00000000') { $hresult = '0x80004005' }
    Write-Line ([ordered]@{ type = 'error'; hresult = $hresult })
    exit 1
}
