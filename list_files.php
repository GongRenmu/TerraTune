<?php
header('Content-Type: application/json');
$files = array();
$dir = '.';
if ($handle = opendir($dir)) {
    while (false !== ($entry = readdir($handle))) {
        if ($entry != "." && $entry != ".." && pathinfo($entry, PATHINFO_EXTENSION) == 'json') {
            $files[] = $entry;
        }
    }
    closedir($handle);
}
echo json_encode($files);
?> 