Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "src\\assets\\icons"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedRectPath {
  param(
    [System.Drawing.RectangleF]$Rect,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$sizes = @(16, 32, 48, 128)

foreach ($size in $sizes) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $size / 128.0
  $outer = New-Object System.Drawing.RectangleF (8 * $scale), (8 * $scale), (112 * $scale), (112 * $scale)
  $outerPath = New-RoundedRectPath -Rect $outer -Radius (28 * $scale)

  $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#1F2F4A"))
  $graphics.FillPath($bgBrush, $outerPath)

  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(30, 255, 255, 255), [Math]::Max(1, 1.5 * $scale))
  $graphics.DrawPath($borderPen, $outerPath)

  $colors = @{
    sidebar = "#34527A"
    primary = "#F4F8FF"
    secondary = "#7CA1D4"
    tertiary = "#2C4366"
    cut = "#1F2F4A"
    dot = "#28C18A"
  }

  $panes = @(
    @{ x = 24; y = 24; w = 12; h = 80; r = 6; c = $colors.sidebar }
    @{ x = 44; y = 24; w = 22; h = 80; r = 11; c = $colors.primary }
    @{ x = 72; y = 24; w = 14; h = 80; r = 7; c = $colors.secondary }
    @{ x = 92; y = 24; w = 12; h = 80; r = 6; c = $colors.tertiary }
  )

  foreach ($pane in $panes) {
    $rect = New-Object System.Drawing.RectangleF ($pane.x * $scale), ($pane.y * $scale), ($pane.w * $scale), ($pane.h * $scale)
    $path = New-RoundedRectPath -Rect $rect -Radius ($pane.r * $scale)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($pane.c))
    $graphics.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
  }

  foreach ($y in @(34, 48, 62, 76)) {
    $lineRect = New-Object System.Drawing.RectangleF (48 * $scale), ($y * $scale), (14 * $scale), (8 * $scale)
    $linePath = New-RoundedRectPath -Rect $lineRect -Radius (4 * $scale)
    $lineBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($colors.cut))
    $graphics.FillPath($lineBrush, $linePath)
    $lineBrush.Dispose()
    $linePath.Dispose()
  }

  $dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($colors.dot))
  $graphics.FillEllipse($dotBrush, 92 * $scale, 28 * $scale, 12 * $scale, 12 * $scale)

  $pathOut = Join-Path $outDir ("icon-{0}.png" -f $size)
  $bitmap.Save($pathOut, [System.Drawing.Imaging.ImageFormat]::Png)

  $dotBrush.Dispose()
  $borderPen.Dispose()
  $bgBrush.Dispose()
  $outerPath.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
