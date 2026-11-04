BrandForge v1.7.29 startup verification

This is a COMPLETE SOURCE ARCHIVE, not a partial Combine patch.
Extract into a real project root containing package.json and src\main\main.js.
For the earlier 'Cannot find module ...\src\main\main.js' error:

  1. Run VERIFY_BRANDFORGE_ROOT.cmd from the extracted project root.
  2. Check that your launcher points to that SAME folder.
  3. Ensure node_modules is installed for 'npm start' from source.
  4. To update a portable compiled EXE you must rebuild the EXE; copying
     source files beside an EXE does not update embedded packaged code.

See INSTALL_FULL_PROJECT_v1.7.29.txt for installation steps.
